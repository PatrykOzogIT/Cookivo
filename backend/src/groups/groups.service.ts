import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateToken, hashToken } from '../auth/tokens.js';
import type { Env } from '../config/env.js';
import { Prisma } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { containsProfanity } from '../moderation/profanity.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SaveGroupDto } from './groups.dto.js';

/** Limity, żeby grupa nie stała się "publiczna tylnymi drzwiami" */
export const MAX_GROUPS_PER_USER = 10;
export const MAX_OWNED_GROUPS = 5;
export const MAX_GROUP_MEMBERS = 30;
export const GROUP_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Ile aktywnych zaproszeń naraz w grupie - chroni przed spamowaniem maili */
const MAX_ACTIVE_INVITES = 20;

type Tx = Prisma.TransactionClient;

/** Id grup, w których użytkownik jest aktywnym członkiem (do widoczności przepisów) */
export function activeGroupsSql(userId: string): Prisma.Sql {
  return Prisma.sql`(SELECT gm.group_id FROM friend_group_members gm
    WHERE gm.user_id = ${userId}::uuid AND gm.status = 'ACTIVE')`;
}

/**
 * Grupy znajomych: dzielenie się przepisami w gronie większym niż gospodarstwo.
 * Zaprasza każdy aktywny członek; osoba zaproszona przez kogoś innego niż właściciel
 * czeka na akceptację właściciela (PENDING) i do tego czasu nie widzi przepisów grupy.
 * Odejście z grupy (albo usunięcie) cofa udostępnienie przepisów tej osoby w tej grupie.
 */
@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Moje grupy (aktywne i oczekujące) + limity */
  async mine(userId: string) {
    const rows = await this.prisma.friendGroupMember.findMany({
      where: { userId },
      include: {
        group: {
          include: {
            _count: { select: { members: { where: { status: 'ACTIVE' } }, recipes: true } },
            members: { where: { status: 'PENDING' }, select: { userId: true } },
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });
    return {
      items: rows.map((m) => ({
        id: m.groupId,
        name: m.group.name,
        description: m.group.description,
        role: m.role,
        status: m.status,
        memberCount: m.group._count.members,
        recipeCount: m.status === 'ACTIVE' ? m.group._count.recipes : null,
        /** Ile osób czeka na akceptację - tylko dla właściciela */
        pendingCount: m.role === 'OWNER' ? m.group.members.length : 0,
      })),
      limits: { groups: MAX_GROUPS_PER_USER, owned: MAX_OWNED_GROUPS, members: MAX_GROUP_MEMBERS },
    };
  }

  /** Szczegóły grupy. Oczekujący widzi tylko nazwę i swój status. */
  async get(userId: string, groupId: string) {
    const me = await this.membership(userId, groupId);
    const group = await this.prisma.friendGroup.findUniqueOrThrow({
      where: { id: groupId },
      include: {
        members: {
          include: {
            user: { select: { username: true } },
            invitedBy: { select: { username: true } },
          },
          orderBy: { joinedAt: 'asc' },
        },
        invites: {
          where: { usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    const isOwner = me.role === 'OWNER';
    const base = {
      id: group.id,
      name: group.name,
      description: group.description,
      role: me.role,
      status: me.status,
      maxMembers: MAX_GROUP_MEMBERS,
    };
    if (me.status === 'PENDING') {
      return { ...base, members: [], pending: [], invites: [], memberCount: 0 };
    }
    const active = group.members.filter((m) => m.status === 'ACTIVE');
    return {
      ...base,
      memberCount: active.length,
      members: active.map((m) => ({
        userId: m.userId,
        username: m.user.username,
        role: m.role,
        joinedAt: m.approvedAt ?? m.joinedAt,
        isMe: m.userId === userId,
      })),
      // Oczekujących widzi i akceptuje właściciel
      pending: isOwner
        ? group.members
            .filter((m) => m.status === 'PENDING')
            .map((m) => ({
              userId: m.userId,
              username: m.user.username,
              invitedBy: m.invitedBy?.username ?? null,
              requestedAt: m.joinedAt,
            }))
        : [],
      // Zaproszenia: właściciel widzi wszystkie, członek - swoje
      invites: group.invites
        .filter((i) => isOwner || i.createdById === userId)
        .map((i) => ({ id: i.id, email: i.email, expiresAt: i.expiresAt, createdAt: i.createdAt })),
    };
  }

  async create(userId: string, dto: SaveGroupDto) {
    this.assertText(dto);
    const id = await this.prisma.$transaction(async (tx) => {
      const [all, owned] = await Promise.all([
        tx.friendGroupMember.count({ where: { userId } }),
        tx.friendGroupMember.count({ where: { userId, role: 'OWNER' } }),
      ]);
      if (all >= MAX_GROUPS_PER_USER) throw new ConflictException({ code: 'GROUP_LIMIT' });
      if (owned >= MAX_OWNED_GROUPS) throw new ConflictException({ code: 'GROUP_OWNED_LIMIT' });
      const group = await tx.friendGroup.create({
        data: {
          name: dto.name.trim(),
          description: dto.description ?? null,
          members: { create: { userId, role: 'OWNER', status: 'ACTIVE', approvedAt: new Date() } },
        },
      });
      return group.id;
    });
    return this.get(userId, id);
  }

  async update(userId: string, groupId: string, dto: SaveGroupDto) {
    this.assertText(dto);
    await this.requireOwner(userId, groupId);
    await this.prisma.friendGroup.update({
      where: { id: groupId },
      data: { name: dto.name.trim(), description: dto.description ?? null },
    });
    return this.get(userId, groupId);
  }

  /** Usunięcie grupy przez właściciela - przepisy przestają być w niej udostępnione */
  async remove(userId: string, groupId: string): Promise<void> {
    await this.requireOwner(userId, groupId);
    await this.prisma.friendGroup.delete({ where: { id: groupId } });
  }

  /** Nowe zaproszenie (każdy aktywny członek). Token zwracamy tylko teraz - w bazie jest hash. */
  async invite(userId: string, groupId: string, email?: string) {
    await this.requireActive(userId, groupId);
    const [count, active] = await Promise.all([
      this.prisma.friendGroupMember.count({ where: { groupId } }),
      this.prisma.friendGroupInvite.count({
        where: { groupId, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ]);
    if (count >= MAX_GROUP_MEMBERS) throw new ConflictException({ code: 'GROUP_FULL' });
    if (active >= MAX_ACTIVE_INVITES) throw new ConflictException({ code: 'TOO_MANY_INVITES' });

    const token = generateToken();
    const invite = await this.prisma.friendGroupInvite.create({
      data: {
        groupId,
        tokenHash: hashToken(token),
        email: email ?? null,
        createdById: userId,
        expiresAt: new Date(Date.now() + GROUP_INVITE_TTL_MS),
      },
      include: { group: true, createdBy: { select: { username: true, locale: true } } },
    });
    const url = `${this.appUrl}/groups/join?token=${token}`;
    if (email) {
      const recipient = await this.prisma.user.findUnique({ where: { email }, select: { locale: true } });
      await this.mail.send(email, 'groupInvite', recipient?.locale ?? invite.createdBy!.locale, {
        username: '',
        url,
        inviter: invite.createdBy!.username,
        group: invite.group.name,
      });
    }
    return { id: invite.id, url, email: invite.email, expiresAt: invite.expiresAt };
  }

  /** Odwołanie zaproszenia: autor zaproszenia albo właściciel */
  async revokeInvite(userId: string, groupId: string, inviteId: string): Promise<void> {
    const me = await this.requireActive(userId, groupId);
    const { count } = await this.prisma.friendGroupInvite.updateMany({
      where: {
        id: inviteId,
        groupId,
        usedAt: null,
        revokedAt: null,
        ...(me.role === 'OWNER' ? {} : { createdById: userId }),
      },
      data: { revokedAt: new Date() },
    });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
  }

  /** Podgląd zaproszenia przed dołączeniem (także dla gościa) */
  async preview(token: string) {
    const invite = await this.findValidInvite(this.prisma, token);
    const members = await this.prisma.friendGroupMember.count({
      where: { groupId: invite.groupId, status: 'ACTIVE' },
    });
    return {
      group: invite.group.name,
      description: invite.group.description,
      invitedBy: invite.createdBy?.username ?? null,
      members,
      /** Zaproszenie od właściciela = od razu członek; od innej osoby = czeka na akceptację */
      needsApproval: !(await this.isOwner(invite.createdById, invite.groupId)),
      expiresAt: invite.expiresAt,
    };
  }

  async join(userId: string, token: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const invite = await this.findValidInvite(tx, token);
      const existing = await tx.friendGroupMember.findUnique({
        where: { groupId_userId: { groupId: invite.groupId, userId } },
      });
      if (existing) throw new ConflictException({ code: 'ALREADY_IN_GROUP' });
      const [mine, count] = await Promise.all([
        tx.friendGroupMember.count({ where: { userId } }),
        tx.friendGroupMember.count({ where: { groupId: invite.groupId } }),
      ]);
      if (mine >= MAX_GROUPS_PER_USER) throw new ConflictException({ code: 'GROUP_LIMIT' });
      if (count >= MAX_GROUP_MEMBERS) throw new ConflictException({ code: 'GROUP_FULL' });
      // Jednorazowe: warunek usedAt: null chroni przed dwoma równoległymi użyciami
      const { count: used } = await tx.friendGroupInvite.updateMany({
        where: { id: invite.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (!used) throw new BadRequestException({ code: 'INVITE_INVALID' });
      const owner = await tx.friendGroupMember.findFirst({
        where: { groupId: invite.groupId, role: 'OWNER' },
        include: { user: { select: { email: true, username: true, locale: true } } },
      });
      const approved = !!owner && owner.userId === invite.createdById;
      await tx.friendGroupMember.create({
        data: {
          groupId: invite.groupId,
          userId,
          status: approved ? 'ACTIVE' : 'PENDING',
          invitedById: invite.createdById,
          approvedAt: approved ? new Date() : null,
        },
      });
      return { invite, owner, approved };
    });

    // Właściciel dowiaduje się mailem o osobie czekającej na akceptację
    if (!result.approved && result.owner) {
      const member = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { username: true },
      });
      await this.mail.send(result.owner.user.email, 'groupJoinRequest', result.owner.user.locale, {
        username: result.owner.user.username,
        member: member.username,
        inviter: result.invite.createdBy?.username ?? '—',
        group: result.invite.group.name,
        url: `${this.appUrl}/groups/${result.invite.groupId}`,
      });
    }
    return this.get(userId, result.invite.groupId);
  }

  /** Akceptacja oczekującej osoby (właściciel) */
  async approve(userId: string, groupId: string, memberId: string) {
    await this.requireOwner(userId, groupId);
    const { count } = await this.prisma.friendGroupMember.updateMany({
      where: { groupId, userId: memberId, status: 'PENDING' },
      data: { status: 'ACTIVE', approvedAt: new Date() },
    });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
    const [member, group] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: memberId } }),
      this.prisma.friendGroup.findUniqueOrThrow({ where: { id: groupId } }),
    ]);
    await this.mail.send(member.email, 'groupApproved', member.locale, {
      username: member.username,
      group: group.name,
      url: `${this.appUrl}/groups/${groupId}`,
    });
    return this.get(userId, groupId);
  }

  /** Usunięcie członka albo odrzucenie oczekującego (właściciel) */
  async removeMember(userId: string, groupId: string, memberId: string) {
    await this.requireOwner(userId, groupId);
    if (memberId === userId) throw new BadRequestException({ code: 'FORBIDDEN' });
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.friendGroupMember.deleteMany({ where: { groupId, userId: memberId } });
      if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
      await unshareRecipes(tx, groupId, memberId);
    });
    return this.get(userId, groupId);
  }

  async transferOwnership(userId: string, groupId: string, memberId: string) {
    await this.requireOwner(userId, groupId);
    const target = await this.prisma.friendGroupMember.findUnique({
      where: { groupId_userId: { groupId, userId: memberId } },
    });
    if (!target || target.status !== 'ACTIVE' || memberId === userId) {
      throw new NotFoundException({ code: 'NOT_FOUND' });
    }
    const owned = await this.prisma.friendGroupMember.count({ where: { userId: memberId, role: 'OWNER' } });
    if (owned >= MAX_OWNED_GROUPS) throw new ConflictException({ code: 'GROUP_OWNED_LIMIT' });
    // Kolejność ważna: unikalny indeks pozwala na jednego właściciela naraz
    await this.prisma.$transaction([
      this.prisma.friendGroupMember.update({
        where: { groupId_userId: { groupId, userId } },
        data: { role: 'MEMBER' },
      }),
      this.prisma.friendGroupMember.update({
        where: { groupId_userId: { groupId, userId: memberId } },
        data: { role: 'OWNER' },
      }),
    ]);
    return this.get(userId, groupId);
  }

  /**
   * Wyjście z grupy. Właściciel przekazuje rolę najdłużej obecnemu aktywnemu członkowi;
   * gdy nie ma komu - grupa znika (oczekujący nie dostają własności).
   */
  async leave(userId: string, groupId: string, tx?: Tx): Promise<void> {
    const run = async (t: Tx) => {
      const me = await t.friendGroupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
      if (!me) throw new NotFoundException({ code: 'NOT_IN_GROUP' });
      await t.friendGroupMember.delete({ where: { groupId_userId: { groupId, userId } } });
      await unshareRecipes(t, groupId, userId);
      if (me.role !== 'OWNER') return;
      const next = await t.friendGroupMember.findFirst({
        where: { groupId, status: 'ACTIVE' },
        orderBy: [{ approvedAt: 'asc' }, { joinedAt: 'asc' }],
      });
      if (next) {
        await t.friendGroupMember.update({
          where: { groupId_userId: { groupId, userId: next.userId } },
          data: { role: 'OWNER' },
        });
      } else {
        await t.friendGroup.delete({ where: { id: groupId } });
      }
    };
    if (tx) await run(tx);
    else await this.prisma.$transaction(run);
  }

  /** Wyjście ze wszystkich grup (usuwanie konta) */
  async leaveAll(userId: string, tx: Tx): Promise<void> {
    const groups = await tx.friendGroupMember.findMany({ where: { userId }, select: { groupId: true } });
    for (const g of groups) await this.leave(userId, g.groupId, tx);
  }

  /** Grupy, w których jestem aktywnym członkiem - tylko tym mogę udostępniać przepisy */
  async activeGroupIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.friendGroupMember.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { groupId: true },
    });
    return rows.map((r) => r.groupId);
  }

  // ---------------------------------------------------------------------------

  private get appUrl(): string {
    return this.config.get('APP_URL', { infer: true });
  }

  private async membership(userId: string, groupId: string) {
    const me = await this.prisma.friendGroupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    // Nie zdradzamy, czy grupa istnieje
    if (!me) throw new NotFoundException({ code: 'NOT_FOUND' });
    return me;
  }

  private async requireActive(userId: string, groupId: string) {
    const me = await this.membership(userId, groupId);
    if (me.status !== 'ACTIVE') throw new ForbiddenException({ code: 'GROUP_PENDING' });
    return me;
  }

  private async requireOwner(userId: string, groupId: string) {
    const me = await this.membership(userId, groupId);
    if (me.role !== 'OWNER') throw new ForbiddenException({ code: 'FORBIDDEN' });
    return me;
  }

  private async isOwner(userId: string | null, groupId: string): Promise<boolean> {
    if (!userId) return false;
    const m = await this.prisma.friendGroupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    return m?.role === 'OWNER';
  }

  private async findValidInvite(db: Tx, token: string) {
    const invite = await db.friendGroupInvite.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { group: true, createdBy: { select: { username: true } } },
    });
    if (!invite || invite.usedAt || invite.revokedAt || invite.expiresAt < new Date()) {
      throw new BadRequestException({ code: 'INVITE_INVALID' });
    }
    return invite;
  }

  private assertText(dto: SaveGroupDto): void {
    if (containsProfanity(dto.name) || (dto.description && containsProfanity(dto.description))) {
      throw new BadRequestException({ code: 'NAME_OFFENSIVE' });
    }
  }
}

/** Cofnięcie udostępnienia przepisów danej osoby w grupie (wyjście / usunięcie z grupy) */
async function unshareRecipes(tx: Tx, groupId: string, userId: string): Promise<void> {
  await tx.$executeRaw`DELETE FROM recipe_friend_groups rg USING recipes r
    WHERE rg.recipe_id = r.id AND rg.group_id = ${groupId}::uuid AND r.author_id = ${userId}::uuid`;
}
