import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../common/auth.decorators.js';
import { ownerScope, type OwnerScope } from '../common/owner-scope.js';
import type { Prisma } from '../generated/prisma/client.js';
import { toDate } from '../planner/planner.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ingredientForMath, RecipeCalculatorService } from '../recipes/recipe-calculator.service.js';
import { gramsFor } from '../recipes/recipe-math.js';
import { normalizePackageUnit } from '../prices/cost-math.js';
import type { PantryItemDto, PantryUpdateDto } from './pantry.dto.js';

/** Ile dni przed końcem ważności pokazujemy "zużyj wkrótce" */
export const EXPIRING_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

const INGREDIENT_INCLUDE = {
  ingredient: { include: { category: true, units: { include: { unit: true } } } },
} satisfies Prisma.PantryItemInclude;

type Row = Prisma.PantryItemGetPayload<{ include: typeof INGREDIENT_INCLUDE }>;

/**
 * Lodówka i spiżarnia gospodarstwa (albo użytkownika). Ilość jest opcjonalna:
 * bez niej wpis znaczy "mam w domu", z nią lista zakupów odejmuje dokładnie.
 */
@Injectable()
export class PantryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: RecipeCalculatorService,
  ) {}

  async list(userId: string) {
    const scope = await ownerScope(this.prisma, userId);
    const rows = await this.prisma.pantryItem.findMany({
      where: scope,
      include: INGREDIENT_INCLUDE,
      orderBy: [{ ingredient: { category: { sortOrder: 'asc' } } }, { ingredient: { namePl: 'asc' } }],
    });
    return { items: rows.map(toDto) };
  }

  /** Dodanie albo aktualizacja wpisu dla składnika (jeden wpis na składnik) */
  async upsert(user: AuthUser, dto: PantryItemDto) {
    const scope = await ownerScope(this.prisma, user.id);
    const ingredient = await this.prisma.ingredient.findUnique({
      where: { id: dto.ingredientId },
      include: { units: true },
    });
    const visible =
      ingredient &&
      (ingredient.status === 'APPROVED' ||
        ingredient.createdById === user.id ||
        user.role === 'ADMIN' ||
        user.role === 'SUPER_ADMIN');
    if (!visible) throw new NotFoundException({ code: 'INGREDIENT_UNKNOWN' });

    const data = await this.quantity(ingredient, dto);
    const existing = await this.prisma.pantryItem.findFirst({
      where: { ...scope, ingredientId: ingredient.id },
    });
    const saved = existing
      ? await this.prisma.pantryItem.update({ where: { id: existing.id }, data, include: INGREDIENT_INCLUDE })
      : await this.prisma.pantryItem.create({
          data: { ...scope, ingredientId: ingredient.id, ...data },
          include: INGREDIENT_INCLUDE,
        });
    return toDto(saved);
  }

  async update(userId: string, id: string, dto: PantryUpdateDto) {
    const item = await this.find(userId, id);
    const ingredient = await this.prisma.ingredient.findUniqueOrThrow({
      where: { id: item.ingredientId },
      include: { units: true },
    });
    const saved = await this.prisma.pantryItem.update({
      where: { id },
      data: await this.quantity(ingredient, dto),
      include: INGREDIENT_INCLUDE,
    });
    return toDto(saved);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.find(userId, id);
    await this.prisma.pantryItem.delete({ where: { id } });
  }

  /** Stan lodówki do odejmowania na liście zakupów: gramy albo null ("mam, ilość nieznana") */
  async stock(scope: OwnerScope): Promise<Map<string, number | null>> {
    const rows = await this.prisma.pantryItem.findMany({
      where: scope,
      select: { ingredientId: true, grams: true },
    });
    return new Map(rows.map((r) => [r.ingredientId, r.grams]));
  }

  /**
   * Dodanie kupionych gramów (lista zakupów, paragon) - stan rośnie, nigdy nie jest zastępowany.
   * Z podaną jednostką (np. 3 l z paragonu) sumujemy w niej, gdy wpis ma tę samą (2 l + 3 l = 5 l);
   * inaczej w gramach. Wpis bez ilości zostaje "mam" (nie wiemy, ile było).
   * `db` pozwala wykonać to w transakcji importu.
   */
  async addGrams(
    scope: OwnerScope,
    ingredientId: string,
    grams: number | null,
    as: { amount: number; unitCode: string } | null = null,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const existing = await db.pantryItem.findFirst({ where: { ...scope, ingredientId } });
    if (!existing) {
      await db.pantryItem.create({
        data: {
          ...scope,
          ingredientId,
          grams,
          amount: as && grams !== null ? as.amount : grams,
          unitCode: grams === null ? null : (as?.unitCode ?? 'g'),
        },
      });
    } else if (existing.grams !== null && grams !== null) {
      // Przyrosty liczone w bazie - równoległa zmiana domownika nie przepada
      const sameUnit = as && existing.amount !== null && existing.unitCode === as.unitCode;
      await db.pantryItem.update({
        where: { id: existing.id },
        data: sameUnit
          ? { grams: { increment: grams }, amount: { increment: as.amount } }
          : { grams: { increment: grams }, amount: existing.grams + grams, unitCode: 'g' },
      });
    }
  }

  // ---------------------------------------------------------------------------

  private async find(userId: string, id: string) {
    const scope = await ownerScope(this.prisma, userId);
    const item = await this.prisma.pantryItem.findFirst({ where: { id, ...scope } });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND' });
    return item;
  }

  private async quantity(
    ingredient: Parameters<typeof ingredientForMath>[0],
    dto: { amount?: number | null; unitCode?: string | null; expiresOn?: string | null },
  ) {
    const expiresOn = dto.expiresOn === undefined ? undefined : dto.expiresOn ? toDate(dto.expiresOn) : null;
    if (!dto.amount) return { amount: null, unitCode: null, grams: null, expiresOn };
    const unitCode = dto.unitCode ?? 'g';
    // kg i l - przez g i ml, które zna gramsFor
    const base = normalizePackageUnit(dto.amount, unitCode);
    const grams = gramsFor(
      base.amount,
      base.unitCode,
      { ingredient: ingredientForMath(ingredient) },
      await this.calculator.unitMl(),
    );
    if (typeof grams !== 'number') throw new BadRequestException({ code: 'UNIT_NOT_ALLOWED' });
    return { amount: dto.amount, unitCode, grams: Math.round(grams * 10) / 10, expiresOn };
  }
}

function toDto(r: Row) {
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const daysLeft = r.expiresOn ? Math.round((r.expiresOn.getTime() - today.getTime()) / DAY_MS) : null;
  return {
    id: r.id,
    ingredient: {
      id: r.ingredient.id,
      namePl: r.ingredient.namePl,
      nameEn: r.ingredient.nameEn,
      density: r.ingredient.density,
      category: {
        code: r.ingredient.category.code,
        namePl: r.ingredient.category.namePl,
        nameEn: r.ingredient.category.nameEn,
        icon: r.ingredient.category.icon,
      },
      units: r.ingredient.units.map((u) => ({
        code: u.unitCode,
        namePl: u.unit.namePl,
        nameEn: u.unit.nameEn,
        grams: u.grams,
      })),
    },
    amount: r.amount,
    unitCode: r.unitCode,
    grams: r.grams,
    expiresOn: r.expiresOn ? r.expiresOn.toISOString().slice(0, 10) : null,
    /** Ile dni do końca ważności (ujemne = po terminie) */
    daysLeft,
    expiring: daysLeft !== null && daysLeft <= EXPIRING_DAYS,
  };
}
