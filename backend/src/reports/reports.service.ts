import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { AuthUser } from '../common/auth.decorators.js';
import { Prisma } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { recomputeRatings } from '../ratings/ratings.service.js';
import { RecipesService } from '../recipes/recipes.service.js';
import type { CreateReportDto, ReportTargetType, ResolveDto } from './reports.dto.js';

/** Po tylu zgłoszeniach od różnych osób treść znika publicznie do decyzji admina */
export const AUTO_HIDE_REPORTS = 3;
/** Znacznik powodu automatycznego ukrycia - front tłumaczy go na tekst */
export const AUTO_HIDDEN = 'AUTO_REPORTS';

interface Target {
  targetType: ReportTargetType;
  recipeId?: string | null;
  userId?: string | null;
}

/** Warunek Prisma na zgłoszenia danego celu */
function targetWhere(t: Target): Prisma.ReportWhereInput {
  return {
    targetType: t.targetType,
    recipeId: t.targetType === 'USER' ? null : t.recipeId!,
    targetUserId: t.targetType === 'RECIPE' ? null : t.userId!,
  };
}

/**
 * Zgłaszanie treści (przepis, opinia, użytkownik) i kolejka moderacji.
 * Po AUTO_HIDE_REPORTS zgłoszeniach treść jest ukrywana automatycznie do decyzji admina.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recipes: RecipesService,
    private readonly mail: MailService,
  ) {}

  async create(user: AuthUser, dto: CreateReportDto) {
    const target = await this.validateTarget(user, dto);
    try {
      await this.prisma.report.create({
        data: {
          targetType: dto.targetType,
          recipeId: target.recipeId ?? null,
          targetUserId: target.userId ?? null,
          reporterId: user.id,
          reason: dto.reason,
          details: dto.details ?? null,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ code: 'ALREADY_REPORTED' });
      }
      throw err;
    }
    const reporters = await this.prisma.report.findMany({
      where: { ...targetWhere(target), status: 'OPEN' },
      distinct: ['reporterId'],
      select: { reporterId: true },
    });
    const autoHidden = reporters.length >= AUTO_HIDE_REPORTS && (await this.hide(target, AUTO_HIDDEN, null));
    return { status: 'OPEN', autoHidden };
  }

  /** Moje zgłoszenia ze statusem (bez maili - zgłaszający sprawdza w aplikacji) */
  async mine(userId: string) {
    const rows = await this.prisma.report.findMany({
      where: { reporterId: userId },
      include: {
        recipe: { select: { id: true, title: true } },
        targetUser: { select: { username: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        targetType: r.targetType,
        recipe: r.recipe,
        username: r.targetUser?.username ?? null,
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt,
      })),
    };
  }

  /** Kolejka admina: zgłoszenia pogrupowane po celu, najwięcej zgłoszeń na górze */
  async queue(status: 'OPEN' | 'ACCEPTED' | 'REJECTED') {
    const rows = await this.prisma.report.findMany({
      where: { status },
      include: {
        recipe: {
          select: {
            id: true,
            title: true,
            hiddenAt: true,
            hiddenReason: true,
            author: { select: { username: true } },
          },
        },
        targetUser: { select: { id: true, username: true, nameHiddenAt: true, blockedAt: true } },
        reporter: { select: { username: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    const groups = new Map<string, { key: string; rows: typeof rows }>();
    for (const r of rows) {
      const key = `${r.targetType}:${r.recipeId ?? '-'}:${r.targetUserId ?? '-'}`;
      groups.set(key, { key, rows: [...(groups.get(key)?.rows ?? []), r] });
    }
    // Treść opinii pobieramy osobno (klucz złożony: przepis + autor)
    const ratingKeys = rows.filter((r) => r.targetType === 'RATING');
    const ratings = ratingKeys.length
      ? await this.prisma.recipeRating.findMany({
          where: { OR: ratingKeys.map((r) => ({ recipeId: r.recipeId!, userId: r.targetUserId! })) },
        })
      : [];
    const items = [...groups.values()].map(({ key, rows: rs }) => {
      const first = rs[0];
      const rating =
        first.targetType === 'RATING'
          ? ratings.find((x) => x.recipeId === first.recipeId && x.userId === first.targetUserId)
          : undefined;
      const hidden =
        first.targetType === 'RECIPE'
          ? !!first.recipe?.hiddenAt
          : first.targetType === 'RATING'
            ? !!rating?.hiddenAt
            : !!first.targetUser?.nameHiddenAt;
      return {
        key,
        targetType: first.targetType,
        recipe: first.recipe
          ? { id: first.recipe.id, title: first.recipe.title, author: first.recipe.author?.username ?? null }
          : null,
        user: first.targetUser ? { id: first.targetUser.id, username: first.targetUser.username } : null,
        rating: rating ? { stars: rating.stars, comment: rating.comment } : null,
        hidden,
        autoHidden:
          hidden &&
          (first.recipe?.hiddenReason === AUTO_HIDDEN ||
            rating?.hiddenReason === AUTO_HIDDEN ||
            first.targetType === 'USER'),
        count: rs.length,
        reports: rs.map((r) => ({
          reason: r.reason,
          details: r.details,
          reporter: r.reporter.username,
          createdAt: r.createdAt,
          resolutionNote: r.resolutionNote,
        })),
        firstAt: first.createdAt,
      };
    });
    items.sort((a, b) => b.count - a.count || a.firstAt.getTime() - b.firstAt.getTime());
    return { items };
  }

  /** Decyzja admina dla wszystkich otwartych zgłoszeń celu */
  async resolve(admin: AuthUser, dto: ResolveDto) {
    const target: Target = { targetType: dto.targetType, recipeId: dto.recipeId, userId: dto.userId };
    const open = await this.prisma.report.count({ where: { ...targetWhere(target), status: 'OPEN' } });
    if (dto.action === 'HIDE') {
      await this.hide(target, dto.note ?? '', admin, true);
    } else {
      await this.restore(target);
    }
    await this.prisma.report.updateMany({
      where: { ...targetWhere(target), status: 'OPEN' },
      data: {
        status: dto.action === 'HIDE' ? 'ACCEPTED' : 'REJECTED',
        resolvedAt: new Date(),
        resolvedById: admin.id,
        resolutionNote: dto.note ?? null,
      },
    });
    return { resolved: open };
  }

  // ---------------------------------------------------------------------------

  /** Sprawdza, czy cel istnieje, jest widoczny dla zgłaszającego i nie jest jego własny */
  private async validateTarget(user: AuthUser, dto: CreateReportDto): Promise<Target> {
    if (dto.targetType === 'RECIPE') {
      if (!dto.recipeId) throw new BadRequestException({ code: 'REPORT_INVALID' });
      const recipe = await this.recipes.get(dto.recipeId, user);
      if (recipe.isOwn) throw new ForbiddenException({ code: 'OWN_CONTENT' });
      return { targetType: 'RECIPE', recipeId: dto.recipeId };
    }
    if (dto.targetType === 'RATING') {
      if (!dto.recipeId || !dto.userId) throw new BadRequestException({ code: 'REPORT_INVALID' });
      if (dto.userId === user.id) throw new ForbiddenException({ code: 'OWN_CONTENT' });
      await this.recipes.get(dto.recipeId, user);
      const rating = await this.prisma.recipeRating.findUnique({
        where: { recipeId_userId: { recipeId: dto.recipeId, userId: dto.userId } },
      });
      if (!rating || rating.hiddenAt) throw new NotFoundException({ code: 'NOT_FOUND' });
      if (dto.userId === user.id) throw new ForbiddenException({ code: 'OWN_CONTENT' });
      return { targetType: 'RATING', recipeId: dto.recipeId, userId: dto.userId };
    }
    if (!dto.userId) throw new BadRequestException({ code: 'REPORT_INVALID' });
    if (dto.userId === user.id) throw new ForbiddenException({ code: 'OWN_CONTENT' });
    const target = await this.prisma.user.findUnique({ where: { id: dto.userId }, select: { id: true } });
    if (!target) throw new NotFoundException({ code: 'NOT_FOUND' });
    return { targetType: 'USER', userId: dto.userId };
  }

  /**
   * Ukrycie celu. Automatyczne (admin = null) tylko chowa treść; decyzja admina dodatkowo
   * powiadamia autora mailem, a w przypadku nazwy użytkownika - zmienia ją na neutralną.
   * Zwraca true, jeśli coś zostało ukryte.
   */
  private async hide(t: Target, reason: string, admin: AuthUser | null, notify = false): Promise<boolean> {
    if (t.targetType === 'RECIPE') {
      const recipe = await this.prisma.recipe.findUnique({
        where: { id: t.recipeId! },
        include: { author: true },
      });
      if (!recipe) throw new NotFoundException({ code: 'NOT_FOUND' });
      if (recipe.hiddenAt && !admin) return false;
      await this.prisma.recipe.update({
        where: { id: recipe.id },
        data: {
          hiddenAt: recipe.hiddenAt ?? new Date(),
          hiddenById: admin?.id ?? null,
          hiddenReason: reason,
        },
      });
      if (notify && recipe.author) {
        await this.mail.send(recipe.author.email, 'contentHidden', recipe.author.locale, {
          username: recipe.author.username,
          title: recipe.title,
          reason: reason || '-',
        });
      }
      return true;
    }
    if (t.targetType === 'RATING') {
      const rating = await this.prisma.recipeRating.findUnique({
        where: { recipeId_userId: { recipeId: t.recipeId!, userId: t.userId! } },
        include: { user: true, recipe: { select: { title: true } } },
      });
      if (!rating) throw new NotFoundException({ code: 'NOT_FOUND' });
      if (rating.hiddenAt && !admin) return false;
      await this.prisma.$transaction(async (tx) => {
        await tx.recipeRating.update({
          where: { recipeId_userId: { recipeId: t.recipeId!, userId: t.userId! } },
          data: { hiddenAt: rating.hiddenAt ?? new Date(), hiddenReason: reason },
        });
        await recomputeRatings(tx, [t.recipeId!]);
      });
      if (notify) {
        await this.mail.send(rating.user.email, 'contentHidden', rating.user.locale, {
          username: rating.user.username,
          title: rating.comment
            ? `${rating.recipe.title}: ${rating.comment.slice(0, 80)}`
            : rating.recipe.title,
          reason: reason || '-',
        });
      }
      return true;
    }
    const user = await this.prisma.user.findUnique({ where: { id: t.userId! } });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND' });
    if (!admin) {
      if (user.nameHiddenAt) return false;
      await this.prisma.user.update({ where: { id: user.id }, data: { nameHiddenAt: new Date() } });
      return true;
    }
    // Decyzja admina: neutralna nazwa zamiast obraźliwej
    const username = await this.freeUsername();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { username, usernameNormalized: username.toLowerCase(), nameHiddenAt: null },
    });
    if (notify) {
      await this.mail.send(user.email, 'usernameReset', user.locale, {
        username,
        title: username,
        reason: reason || '-',
      });
    }
    return true;
  }

  private async restore(t: Target): Promise<void> {
    if (t.targetType === 'RECIPE') {
      await this.prisma.recipe.updateMany({
        where: { id: t.recipeId! },
        data: { hiddenAt: null, hiddenById: null, hiddenReason: null },
      });
    } else if (t.targetType === 'RATING') {
      await this.prisma.$transaction(async (tx) => {
        await tx.recipeRating.updateMany({
          where: { recipeId: t.recipeId!, userId: t.userId! },
          data: { hiddenAt: null, hiddenReason: null },
        });
        await recomputeRatings(tx, [t.recipeId!]);
      });
    } else {
      await this.prisma.user.updateMany({ where: { id: t.userId! }, data: { nameHiddenAt: null } });
    }
  }

  /** Wolna nazwa "kucharz_12345" */
  private async freeUsername(): Promise<string> {
    for (;;) {
      const name = `kucharz_${randomInt(10000, 99999)}`;
      const taken = await this.prisma.user.findUnique({ where: { usernameNormalized: name } });
      if (!taken) return name;
    }
  }
}
