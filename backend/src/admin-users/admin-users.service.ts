import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { activeBlock } from '../common/account-block.js';
import type { AuthUser } from '../common/auth.decorators.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { BlockDto, UsersQueryDto } from './admin-users.dto.js';

const PAGE_SIZE = 20;

/** Panel admina: lista kont, blokady (czasowe i stałe) oraz role */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async list(q: UsersQueryDto) {
    const page = q.page ?? 1;
    const now = new Date();
    const and: Prisma.UserWhereInput[] = [];
    const text = q.q?.trim();
    if (text) {
      and.push({
        OR: [
          { usernameNormalized: { contains: text.toLowerCase() } },
          { email: { contains: text.toLowerCase() } },
        ],
      });
    }
    if (q.filter === 'blocked') {
      and.push({ blockedAt: { not: null }, OR: [{ blockedUntil: null }, { blockedUntil: { gt: now } }] });
    }
    if (q.filter === 'admins') and.push({ role: { in: ['ADMIN', 'SUPER_ADMIN'] } });
    const where: Prisma.UserWhereInput = { AND: and };

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          _count: { select: { recipes: true, reportsAgainst: { where: { status: 'OPEN' } } } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      total,
      page,
      pageSize: PAGE_SIZE,
      items: rows.map((u) => {
        const block = activeBlock(u, now);
        return {
          id: u.id,
          username: u.username,
          email: u.email,
          role: u.role,
          emailVerified: !!u.emailVerifiedAt,
          createdAt: u.createdAt,
          lastLoginAt: u.lastLoginAt,
          recipesCount: u._count.recipes,
          openReports: u._count.reportsAgainst,
          block: block ? { until: block.until, reason: block.reason } : null,
        };
      }),
    };
  }

  async block(actor: AuthUser, id: string, dto: BlockDto) {
    const user = await this.target(actor, id);
    // Admina może zablokować tylko super admin
    if (user.role !== 'USER' && actor.role !== 'SUPER_ADMIN')
      throw new ForbiddenException({ code: 'FORBIDDEN' });
    const now = new Date();
    const until = dto.days ? new Date(now.getTime() + dto.days * 86_400_000) : null;
    const reason = dto.reason.trim();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { blockedAt: now, blockedUntil: until, blockReason: reason },
      }),
      // Wylogowanie ze wszystkich urządzeń
      this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } }),
    ]);
    await this.mail.send(user.email, 'accountBlocked', user.locale, {
      username: user.username,
      reason,
      until: until
        ? new Intl.DateTimeFormat(user.locale, {
            dateStyle: 'long',
            timeStyle: 'short',
            timeZone: 'Europe/Warsaw',
          }).format(until)
        : undefined,
    });
    return { block: { until, reason } };
  }

  async unblock(actor: AuthUser, id: string) {
    const user = await this.target(actor, id);
    if (user.role !== 'USER' && actor.role !== 'SUPER_ADMIN')
      throw new ForbiddenException({ code: 'FORBIDDEN' });
    await this.prisma.user.update({
      where: { id },
      data: { blockedAt: null, blockedUntil: null, blockReason: null },
    });
    return { block: null };
  }

  /** Nadanie / odebranie roli ADMIN (endpoint tylko dla SUPER_ADMIN) */
  async setRole(actor: AuthUser, id: string, role: 'USER' | 'ADMIN') {
    await this.target(actor, id);
    await this.prisma.user.update({ where: { id }, data: { role } });
    return { role };
  }

  /** Konto docelowe: istnieje, to nie ja i nie super admin */
  private async target(actor: AuthUser, id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND' });
    if (user.id === actor.id) throw new ForbiddenException({ code: 'CANNOT_MODIFY_SELF' });
    if (user.role === 'SUPER_ADMIN') throw new ForbiddenException({ code: 'FORBIDDEN' });
    return user;
  }
}
