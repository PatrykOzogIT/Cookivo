import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../common/auth.decorators.js';
import { ownerScope, type OwnerScope } from '../common/owner-scope.js';
import { containsProfanity } from '../moderation/profanity.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ingredientForMath, RecipeCalculatorService } from '../recipes/recipe-calculator.service.js';
import { gramsFor } from '../recipes/recipe-math.js';
import { RecipesService } from '../recipes/recipes.service.js';
import { ingredientNeeds } from '../shopping/recipe-loader.js';
import { LIQUID_CATEGORIES } from '../shopping/shopping-math.js';
import { costOf, normalizePackageUnit, unitPrice } from './cost-math.js';
import type { PriceEntryDto, PriceListDto, UpdatePriceListDto } from './prices.dto.js';

/** Szacunek kosztu do pokazania w interfejsie */
export interface CostSummary {
  currency: string;
  listName: string;
  cents: number;
  priced: number;
  missing: { id: string; namePl: string; nameEn: string | null }[];
}

/**
 * Cenniki gospodarstwa (albo użytkownika). Ceny za opakowanie; koszty liczymy
 * z domyślnego cennika. Brak cennika = brak kosztów (nie zgadujemy cen).
 */
@Injectable()
export class PricesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: RecipeCalculatorService,
    private readonly recipes: RecipesService,
  ) {}

  async lists(userId: string) {
    const scope = await ownerScope(this.prisma, userId);
    const rows = await this.prisma.priceList.findMany({
      where: scope,
      include: { _count: { select: { entries: true } } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return {
      lists: rows.map((l) => ({
        id: l.id,
        name: l.name,
        currency: l.currency,
        isDefault: l.isDefault,
        entries: l._count.entries,
      })),
    };
  }

  async create(userId: string, dto: PriceListDto) {
    const scope = await ownerScope(this.prisma, userId);
    this.assertName(dto.name);
    // Pierwszy cennik od razu domyślny
    const hasDefault = await this.prisma.priceList.count({ where: { ...scope, isDefault: true } });
    await this.prisma.priceList.create({
      data: { ...scope, name: dto.name, currency: dto.currency ?? 'PLN', isDefault: !hasDefault },
    });
    return this.lists(userId);
  }

  async update(userId: string, id: string, dto: UpdatePriceListDto) {
    const scope = await ownerScope(this.prisma, userId);
    const list = await this.findList(scope, id);
    if (dto.name) this.assertName(dto.name);
    await this.prisma.$transaction(async (tx) => {
      // Najpierw zdejmujemy poprzedni domyślny - unikalny indeks pozwala na jeden
      if (dto.isDefault) {
        await tx.priceList.updateMany({ where: { ...scope, isDefault: true }, data: { isDefault: false } });
      }
      await tx.priceList.update({
        where: { id: list.id },
        data: {
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.currency ? { currency: dto.currency } : {}),
          ...(dto.isDefault ? { isDefault: true } : {}),
        },
      });
    });
    return this.lists(userId);
  }

  /** Usunięcie domyślnego przekazuje tę rolę najstarszemu z pozostałych */
  async remove(userId: string, id: string) {
    const scope = await ownerScope(this.prisma, userId);
    const list = await this.findList(scope, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.priceList.delete({ where: { id: list.id } });
      if (list.isDefault) {
        const next = await tx.priceList.findFirst({ where: scope, orderBy: { createdAt: 'asc' } });
        if (next) await tx.priceList.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
    return this.lists(userId);
  }

  async entries(userId: string, listId: string) {
    const scope = await ownerScope(this.prisma, userId);
    const list = await this.findList(scope, listId);
    const rows = await this.prisma.priceEntry.findMany({
      where: { listId: list.id },
      include: { ingredient: { include: { category: true, units: true } } },
      orderBy: { ingredient: { namePl: 'asc' } },
    });
    return {
      list: { id: list.id, name: list.name, currency: list.currency, isDefault: list.isDefault },
      entries: rows.map((e) => ({
        id: e.id,
        ingredient: {
          id: e.ingredient.id,
          namePl: e.ingredient.namePl,
          nameEn: e.ingredient.nameEn,
          category: { code: e.ingredient.category.code, icon: e.ingredient.category.icon },
        },
        packageAmount: e.packageAmount,
        packageUnitCode: e.packageUnitCode,
        priceCents: e.priceCents,
        unitPrice: unitPrice(e, {
          density: e.ingredient.density,
          pieceGrams: e.ingredient.units.find((u) => u.unitCode === 'PIECE')?.grams ?? null,
          liquid: LIQUID_CATEGORIES.has(e.ingredient.category.code),
        }),
        updatedAt: e.updatedAt,
      })),
    };
  }

  /** Dodanie albo zmiana ceny składnika w cenniku */
  async setEntry(user: AuthUser, listId: string, dto: PriceEntryDto) {
    const scope = await ownerScope(this.prisma, user.id);
    const list = await this.findList(scope, listId);
    const ingredient = await this.prisma.ingredient.findUnique({
      where: { id: dto.ingredientId },
      include: { units: true },
    });
    if (!ingredient || (ingredient.status !== 'APPROVED' && ingredient.createdById !== user.id)) {
      throw new NotFoundException({ code: 'INGREDIENT_UNKNOWN' });
    }
    const pkg = normalizePackageUnit(dto.packageAmount, dto.packageUnitCode);
    const grams = gramsFor(
      pkg.amount,
      pkg.unitCode,
      { ingredient: ingredientForMath(ingredient) },
      await this.calculator.unitMl(),
    );
    if (typeof grams !== 'number' || grams <= 0) throw new BadRequestException({ code: 'UNIT_NOT_ALLOWED' });
    const data = {
      packageAmount: dto.packageAmount,
      packageUnitCode: dto.packageUnitCode,
      packageGrams: grams,
      priceCents: Math.round(dto.price * 100),
    };
    await this.prisma.priceEntry.upsert({
      where: { listId_ingredientId: { listId: list.id, ingredientId: ingredient.id } },
      create: { listId: list.id, ingredientId: ingredient.id, ...data },
      update: data,
    });
    return this.entries(user.id, list.id);
  }

  async removeEntry(userId: string, listId: string, entryId: string) {
    const scope = await ownerScope(this.prisma, userId);
    const list = await this.findList(scope, listId);
    const { count } = await this.prisma.priceEntry.deleteMany({ where: { id: entryId, listId: list.id } });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
    return this.entries(userId, list.id);
  }

  // --- Koszty --------------------------------------------------------------------------

  /** Ceny za gram z domyślnego cennika właściciela (null = brak cennika) */
  async defaultPrices(scope: OwnerScope) {
    const list = await this.prisma.priceList.findFirst({
      where: { ...scope, isDefault: true },
      include: { entries: { select: { ingredientId: true, priceCents: true, packageGrams: true } } },
    });
    if (!list) return null;
    return {
      list,
      centsPerGram: new Map(list.entries.map((e) => [e.ingredientId, e.priceCents / e.packageGrams])),
    };
  }

  /** Koszt potrzebnych gramów (lista zakupów, plan) wg domyślnego cennika */
  async cost(scope: OwnerScope, need: Map<string, number>): Promise<CostSummary | null> {
    const prices = await this.defaultPrices(scope);
    if (!prices) return null;
    const result = costOf(need, prices.centsPerGram);
    const missing = result.missing.length
      ? await this.prisma.ingredient.findMany({
          where: { id: { in: result.missing } },
          select: { id: true, namePl: true, nameEn: true },
          orderBy: { namePl: 'asc' },
        })
      : [];
    return {
      currency: prices.list.currency,
      listName: prices.list.name,
      cents: result.cents,
      priced: result.priced,
      missing,
    };
  }

  /** Koszt przepisu na wybraną liczbę porcji (z podprzepisami) */
  async recipeCost(user: AuthUser, recipeId: string, servings: number) {
    const recipe = await this.recipes.get(recipeId, user);
    const scope = await ownerScope(this.prisma, user.id);
    const need = await ingredientNeeds(this.prisma, [
      { recipeId, factor: servings / Math.max(1, recipe.servings) },
    ]);
    const cost = await this.cost(scope, need);
    return { cost: cost ? { ...cost, perServingCents: Math.round(cost.cents / servings) } : null };
  }

  // ---------------------------------------------------------------------------

  private async findList(scope: OwnerScope, id: string) {
    const list = await this.prisma.priceList.findFirst({ where: { id, ...scope } });
    if (!list) throw new NotFoundException({ code: 'NOT_FOUND' });
    return list;
  }

  private assertName(name: string): void {
    if (containsProfanity(name)) throw new BadRequestException({ code: 'NAME_OFFENSIVE' });
  }
}
