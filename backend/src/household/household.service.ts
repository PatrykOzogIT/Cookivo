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
import type { Prisma } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { containsProfanity } from '../moderation/profanity.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProfileService } from '../profile/profile.service.js';

export const MAX_MEMBERS = 8;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Ile aktywnych zaproszeń naraz - chroni przed spamowaniem maili */
const MAX_ACTIVE_INVITES = 10;
export const HOUSEHOLD_ALLERGIES_CONSENT_VERSION = '2026-09-30';

type Tx = Prisma.TransactionClient;

/**
 * Gospodarstwo domowe: wspólne planowanie dla kilku osób.
 * Jedna osoba = najwyżej jedno gospodarstwo. Zarządza właściciel (zaproszenia, członkowie, nazwa).
 * Alergie domowników są widoczne i uwzględniane w trybie "Dla nas" tylko za zgodą ich właściciela.
 */
@Injectable()
export class HouseholdService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly profile: ProfileService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Moje gospodarstwo (null = nie należę do żadnego) */
  async mine(userId: string) {
    const me = await this.prisma.householdMember.findUnique({ where: { userId } });
    if (!me) return null;
    const household = await this.prisma.household.findUniqueOrThrow({
      where: { id: me.householdId },
      include: {
        members: {
          include: {
            user: {
              select: {
                username: true,
                allergens: { include: { allergen: true }, orderBy: { allergen: { sortOrder: 'asc' } } },
              },
            },
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
    return {
      id: household.id,
      name: household.name,
      role: me.role,
      maxMembers: MAX_MEMBERS,
      members: household.members.map((m) => ({
        userId: m.userId,
        username: m.user.username,
        role: m.role,
        joinedAt: m.joinedAt,
        isMe: m.userId === userId,
        shareAllergies: m.shareAllergies,
        // Alergie innych tylko za ich zgodą; swoje widzę zawsze
        allergens:
          m.shareAllergies || m.userId === userId
            ? m.user.allergens.map((a) => ({
                code: a.allergen.code,
                namePl: a.allergen.namePl,
                nameEn: a.allergen.nameEn,
                severity: a.severity,
              }))
            : null,
      })),
      // Zaproszenia widzi i odwołuje właściciel
      invites: isOwner
        ? household.invites.map((i) => ({
            id: i.id,
            email: i.email,
            expiresAt: i.expiresAt,
            createdAt: i.createdAt,
          }))
        : [],
    };
  }

  async create(userId: string, name: string) {
    this.assertName(name);
    await this.prisma.$transaction(async (tx) => {
      if (await tx.householdMember.findUnique({ where: { userId } })) {
        throw new ConflictException({ code: 'ALREADY_IN_HOUSEHOLD' });
      }
      await tx.household.create({
        data: { name: name.trim(), members: { create: { userId, role: 'OWNER' } } },
      });
    });
    return this.mine(userId);
  }

  async rename(userId: string, name: string) {
    this.assertName(name);
    const me = await this.requireOwner(userId);
    await this.prisma.household.update({ where: { id: me.householdId }, data: { name: name.trim() } });
    return this.mine(userId);
  }

  /** Nowe zaproszenie. Token zwracamy tylko teraz - w bazie jest jego hash. */
  async invite(userId: string, email?: string) {
    const me = await this.requireOwner(userId);
    const [count, active] = await Promise.all([
      this.prisma.householdMember.count({ where: { householdId: me.householdId } }),
      this.prisma.householdInvite.count({
        where: { householdId: me.householdId, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ]);
    if (count >= MAX_MEMBERS) throw new ConflictException({ code: 'HOUSEHOLD_FULL' });
    if (active >= MAX_ACTIVE_INVITES) throw new ConflictException({ code: 'TOO_MANY_INVITES' });

    const token = generateToken();
    const invite = await this.prisma.householdInvite.create({
      data: {
        householdId: me.householdId,
        tokenHash: hashToken(token),
        email: email ?? null,
        createdById: userId,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
      include: { household: true, createdBy: { select: { username: true, locale: true } } },
    });
    const url = `${this.config.get('APP_URL', { infer: true })}/household/join?token=${token}`;

    if (email) {
      // Język zaproszenia: odbiorcy, jeśli ma konto, inaczej zapraszającego
      const recipient = await this.prisma.user.findUnique({ where: { email }, select: { locale: true } });
      await this.mail.send(email, 'householdInvite', recipient?.locale ?? invite.createdBy!.locale, {
        username: '',
        url,
        inviter: invite.createdBy!.username,
        household: invite.household.name,
      });
    }
    return { id: invite.id, url, email: invite.email, expiresAt: invite.expiresAt };
  }

  async revokeInvite(userId: string, inviteId: string): Promise<void> {
    const me = await this.requireOwner(userId);
    const { count } = await this.prisma.householdInvite.updateMany({
      where: { id: inviteId, householdId: me.householdId, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
  }

  /** Podgląd zaproszenia przed dołączeniem (także dla gościa - żeby wiedział, do czego się loguje) */
  async preview(token: string) {
    const invite = await this.findValidInvite(this.prisma, token);
    const members = await this.prisma.householdMember.count({ where: { householdId: invite.householdId } });
    return {
      household: invite.household.name,
      invitedBy: invite.createdBy?.username ?? null,
      members,
      expiresAt: invite.expiresAt,
    };
  }

  async join(userId: string, token: string) {
    await this.prisma.$transaction(async (tx) => {
      const invite = await this.findValidInvite(tx, token);
      if (await tx.householdMember.findUnique({ where: { userId } })) {
        throw new ConflictException({ code: 'ALREADY_IN_HOUSEHOLD' });
      }
      const count = await tx.householdMember.count({ where: { householdId: invite.householdId } });
      if (count >= MAX_MEMBERS) throw new ConflictException({ code: 'HOUSEHOLD_FULL' });
      // Jednorazowe: warunek usedAt: null chroni przed dwoma równoległymi użyciami
      const { count: used } = await tx.householdInvite.updateMany({
        where: { id: invite.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (!used) throw new BadRequestException({ code: 'INVITE_INVALID' });
      await tx.householdMember.create({ data: { userId, householdId: invite.householdId } });
    });
    return this.mine(userId);
  }

  /**
   * Opuszczenie gospodarstwa. Właściciel przekazuje rolę najdłużej obecnemu domownikowi;
   * ostatnia osoba zamyka gospodarstwo (razem z zaproszeniami).
   */
  async leave(userId: string, tx?: Tx): Promise<void> {
    const run = async (t: Tx) => {
      const me = await t.householdMember.findUnique({ where: { userId } });
      if (!me) throw new NotFoundException({ code: 'NOT_IN_HOUSEHOLD' });
      await t.householdMember.delete({ where: { userId } });
      const next = await t.householdMember.findFirst({
        where: { householdId: me.householdId },
        orderBy: { joinedAt: 'asc' },
      });
      if (!next) {
        await t.household.delete({ where: { id: me.householdId } });
      } else if (me.role === 'OWNER') {
        await t.householdMember.update({ where: { userId: next.userId }, data: { role: 'OWNER' } });
      }
    };
    if (tx) await run(tx);
    else await this.prisma.$transaction(run);
  }

  async removeMember(userId: string, memberId: string) {
    const me = await this.requireOwner(userId);
    if (memberId === userId) throw new BadRequestException({ code: 'FORBIDDEN' });
    const { count } = await this.prisma.householdMember.deleteMany({
      where: { userId: memberId, householdId: me.householdId },
    });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
    return this.mine(userId);
  }

  async transferOwnership(userId: string, memberId: string) {
    const me = await this.requireOwner(userId);
    const target = await this.prisma.householdMember.findUnique({ where: { userId: memberId } });
    if (!target || target.householdId !== me.householdId || memberId === userId) {
      throw new NotFoundException({ code: 'NOT_FOUND' });
    }
    // Kolejność ważna: unikalny indeks pozwala na jednego właściciela naraz
    await this.prisma.$transaction([
      this.prisma.householdMember.update({ where: { userId }, data: { role: 'MEMBER' } }),
      this.prisma.householdMember.update({ where: { userId: memberId }, data: { role: 'OWNER' } }),
    ]);
    return this.mine(userId);
  }

  /** Zgoda na udostępnienie alergii domownikom (dane o zdrowiu - osobna, wycofywalna zgoda) */
  async setShareAllergies(userId: string, share: boolean, ip?: string) {
    const me = await this.prisma.householdMember.findUnique({ where: { userId } });
    if (!me) throw new NotFoundException({ code: 'NOT_IN_HOUSEHOLD' });
    if (share && !(await this.profile.hasHealthConsent(userId))) {
      throw new ForbiddenException({ code: 'HEALTH_CONSENT_REQUIRED' });
    }
    if (share === me.shareAllergies) return this.mine(userId);
    await this.prisma.$transaction([
      this.prisma.householdMember.update({ where: { userId }, data: { shareAllergies: share } }),
      share
        ? this.prisma.consent.create({
            data: { userId, type: 'HOUSEHOLD_ALLERGIES', version: HOUSEHOLD_ALLERGIES_CONSENT_VERSION, ip },
          })
        : this.prisma.consent.updateMany({
            where: { userId, type: 'HOUSEHOLD_ALLERGIES', revokedAt: null },
            data: { revokedAt: new Date() },
          }),
    ]);
    return this.mine(userId);
  }

  /** Id domowników (bez mnie) - do widoczności przepisów "dla gospodarstwa" */
  async mateIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ user_id: string }[]>`
      SELECT m2.user_id FROM household_members m1
      JOIN household_members m2 ON m2.household_id = m1.household_id AND m2.user_id <> m1.user_id
      WHERE m1.user_id = ${userId}::uuid`;
    return rows.map((r) => r.user_id);
  }

  /**
   * Kogo uwzględnia tryb "Dla nas": preferencje wszystkich domowników,
   * alergie - moje i tych, którzy zgodzili się je udostępnić.
   */
  async forUsContext(userId: string): Promise<{ memberIds: string[]; allergenUserIds: string[] }> {
    const me = await this.prisma.householdMember.findUnique({ where: { userId } });
    if (!me) return { memberIds: [userId], allergenUserIds: [userId] };
    const members = await this.prisma.householdMember.findMany({ where: { householdId: me.householdId } });
    return {
      memberIds: members.map((m) => m.userId),
      allergenUserIds: members.filter((m) => m.userId === userId || m.shareAllergies).map((m) => m.userId),
    };
  }

  // ---------------------------------------------------------------------------

  private async requireOwner(userId: string) {
    const me = await this.prisma.householdMember.findUnique({ where: { userId } });
    if (!me) throw new NotFoundException({ code: 'NOT_IN_HOUSEHOLD' });
    if (me.role !== 'OWNER') throw new ForbiddenException({ code: 'FORBIDDEN' });
    return me;
  }

  private async findValidInvite(db: Tx, token: string) {
    const invite = await db.householdInvite.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { household: true, createdBy: { select: { username: true } } },
    });
    if (!invite || invite.usedAt || invite.revokedAt || invite.expiresAt < new Date()) {
      throw new BadRequestException({ code: 'INVITE_INVALID' });
    }
    return invite;
  }

  private assertName(name: string): void {
    if (containsProfanity(name)) throw new BadRequestException({ code: 'NAME_OFFENSIVE' });
  }
}
