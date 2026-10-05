import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../common/auth.decorators.js';
import type { Prisma } from '../generated/prisma/client.js';
import { containsProfanity } from '../moderation/profanity.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecipesService } from '../recipes/recipes.service.js';

const PAGE_SIZE = 10;

/** Przelicza średnią i liczbę ocen zapisane w przepisach (po zmianie ocen albo usunięciu konta) */
export async function recomputeRatings(db: Prisma.TransactionClient, recipeIds: string[]): Promise<void> {
  if (!recipeIds.length) return;
  for (const recipeId of new Set(recipeIds)) {
    const agg = await db.recipeRating.aggregate({ where: { recipeId }, _avg: { stars: true }, _count: true });
    await db.recipe.updateMany({
      where: { id: recipeId },
      data: { ratingAvg: agg._avg.stars, ratingCount: agg._count },
    });
  }
}

/**
 * Oceny przepisów: gwiazdki 1-5 i opcjonalny komentarz. Oceniać może każdy zalogowany,
 * kto widzi przepis - poza autorem. Jedna ocena na osobę (można ją zmienić albo usunąć).
 */
@Injectable()
export class RatingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recipes: RecipesService,
  ) {}

  async rate(user: AuthUser, recipeId: string, stars: number, comment?: string) {
    const recipe = await this.recipes.get(recipeId, user);
    if (recipe.isOwn) throw new ForbiddenException({ code: 'OWN_RECIPE' });
    if (comment && containsProfanity(comment)) throw new BadRequestException({ code: 'CONTENT_OFFENSIVE' });
    await this.prisma.$transaction(async (tx) => {
      await tx.recipeRating.upsert({
        where: { recipeId_userId: { recipeId, userId: user.id } },
        create: { recipeId, userId: user.id, stars, comment: comment ?? null },
        update: { stars, comment: comment ?? null },
      });
      await recomputeRatings(tx, [recipeId]);
    });
    return this.summary(recipeId, user);
  }

  async remove(user: AuthUser, recipeId: string) {
    const { count } = await this.prisma.recipeRating.deleteMany({ where: { recipeId, userId: user.id } });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
    await recomputeRatings(this.prisma, [recipeId]);
    return this.summary(recipeId, user);
  }

  /** Opinie pod przepisem (najnowsze najpierw); dostępne dla każdego, kto widzi przepis */
  async list(recipeId: string, page: number, user?: AuthUser) {
    await this.recipes.get(recipeId, user);
    const where = { recipeId };
    const [rows, total] = await Promise.all([
      this.prisma.recipeRating.findMany({
        where,
        include: { user: { select: { username: true } } },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.recipeRating.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        username: r.user.username,
        isMine: r.userId === user?.id,
        stars: r.stars,
        comment: r.comment,
        updatedAt: r.updatedAt,
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  private async summary(recipeId: string, user: AuthUser) {
    const [recipe, mine] = await Promise.all([
      this.prisma.recipe.findUniqueOrThrow({
        where: { id: recipeId },
        select: { ratingAvg: true, ratingCount: true },
      }),
      this.prisma.recipeRating.findUnique({ where: { recipeId_userId: { recipeId, userId: user.id } } }),
    ]);
    return {
      ratingAvg: recipe.ratingAvg === null ? null : Math.round(recipe.ratingAvg * 10) / 10,
      ratingCount: recipe.ratingCount,
      myRating: mine ? { stars: mine.stars, comment: mine.comment } : null,
    };
  }
}
