import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../common/auth.decorators.js';
import { ownerScope, type OwnerScope } from '../common/owner-scope.js';
import type { Prisma } from '../generated/prisma/client.js';
import { containsProfanity } from '../moderation/profanity.js';
import { PantryService } from '../pantry/pantry.service.js';
import { toDate } from '../planner/planner.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ingredientForMath, RecipeCalculatorService } from '../recipes/recipe-calculator.service.js';
import { gramsFor } from '../recipes/recipe-math.js';
import { RecipesService } from '../recipes/recipes.service.js';
import type { AddItemDto } from './shopping.dto.js';
import { expandRecipe, LIQUID_CATEGORIES, shoppingAmount, type RecipeForShopping } from './shopping-math.js';

const MAX_RANGE_DAYS = 42;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Resztki poniżej tej wagi pomijamy (np. 3 g soli, gdy w lodówce jest prawie wszystko) */
const MIN_GRAMS = 1;

const ITEM_INCLUDE = {
  ingredient: { include: { category: true, units: true } },
  checkedBy: { select: { username: true } },
} satisfies Prisma.ShoppingItemInclude;

type Row = Prisma.ShoppingItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

export interface AddResult {
  added: number;
  /** Pominięte, bo są w lodówce (bez ilości albo w wystarczającej ilości) */
  inPantry: { id: string; namePl: string; nameEn: string | null }[];
}

/**
 * Wspólna lista zakupów gospodarstwa (albo użytkownika). Pozycje ze składnikami sumują się:
 * dodanie tego samego składnika zwiększa nieodhaczoną pozycję zamiast tworzyć drugą.
 */
@Injectable()
export class ShoppingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recipes: RecipesService,
    private readonly calculator: RecipeCalculatorService,
    private readonly pantry: PantryService,
  ) {}

  async list(userId: string) {
    const scope = await ownerScope(this.prisma, userId);
    const rows = await this.prisma.shoppingItem.findMany({
      where: scope,
      include: ITEM_INCLUDE,
      orderBy: [{ checked: 'asc' }, { createdAt: 'asc' }],
    });
    return { items: rows.map(toDto) };
  }

  /** Składniki na partie ugotowane w zakresie dat planu, minus to, co jest w lodówce */
  async addFromPlan(userId: string, fromIso: string, toIso: string): Promise<AddResult> {
    const from = toDate(fromIso);
    const to = toDate(toIso);
    const span = Math.round((to.getTime() - from.getTime()) / DAY_MS);
    if (span < 0 || span >= MAX_RANGE_DAYS) throw new BadRequestException({ code: 'DATE_RANGE_INVALID' });

    const scope = await ownerScope(this.prisma, userId);
    const cooks = await this.prisma.planCook.findMany({
      where: { ...scope, date: { gte: from, lte: to } },
      include: { recipe: { select: { servings: true } } },
    });
    const recipes = await this.loadRecipes(cooks.map((c) => c.recipeId));
    const need = new Map<string, number>();
    for (const c of cooks)
      expandRecipe(c.recipeId, c.servings / Math.max(1, c.recipe.servings), recipes, need);
    return this.merge(scope, need);
  }

  async addFromRecipe(user: AuthUser, recipeId: string, servings: number): Promise<AddResult> {
    // Rzuci NOT_FOUND, jeśli przepisu nie widać
    const recipe = await this.recipes.get(recipeId, user);
    const scope = await ownerScope(this.prisma, user.id);
    const recipes = await this.loadRecipes([recipeId]);
    const need = expandRecipe(recipeId, servings / Math.max(1, recipe.servings), recipes);
    return this.merge(scope, need);
  }

  async addItem(user: AuthUser, dto: AddItemDto) {
    const scope = await ownerScope(this.prisma, user.id);
    if (!!dto.ingredientId === !!dto.name) throw new BadRequestException({ code: 'ITEM_INVALID' });
    if (dto.name) {
      if (containsProfanity(dto.name)) throw new BadRequestException({ code: 'NAME_OFFENSIVE' });
      const row = await this.prisma.shoppingItem.create({
        data: { ...scope, name: dto.name, note: dto.note || null },
        include: ITEM_INCLUDE,
      });
      return toDto(row);
    }
    const ingredient = await this.prisma.ingredient.findUnique({
      where: { id: dto.ingredientId },
      include: { units: true },
    });
    if (!ingredient || (ingredient.status !== 'APPROVED' && ingredient.createdById !== user.id)) {
      throw new NotFoundException({ code: 'INGREDIENT_UNKNOWN' });
    }
    let grams: number | null = null;
    if (dto.amount) {
      const g = gramsFor(
        dto.amount,
        dto.unitCode ?? 'g',
        { ingredient: ingredientForMath(ingredient) },
        await this.calculator.unitMl(),
      );
      if (typeof g !== 'number') throw new BadRequestException({ code: 'UNIT_NOT_ALLOWED' });
      grams = g;
    }
    const id = await this.addGrams(scope, ingredient.id, grams, dto.note || null);
    return toDto(await this.prisma.shoppingItem.findUniqueOrThrow({ where: { id }, include: ITEM_INCLUDE }));
  }

  async update(userId: string, id: string, dto: { checked?: boolean; note?: string }) {
    const scope = await ownerScope(this.prisma, userId);
    const item = await this.prisma.shoppingItem.findFirst({ where: { id, ...scope } });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND' });
    const row = await this.prisma.shoppingItem.update({
      where: { id },
      data: {
        ...(dto.note !== undefined ? { note: dto.note || null } : {}),
        ...(dto.checked !== undefined
          ? {
              checked: dto.checked,
              checkedById: dto.checked ? userId : null,
              checkedAt: dto.checked ? new Date() : null,
            }
          : {}),
      },
      include: ITEM_INCLUDE,
    });
    return toDto(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    const scope = await ownerScope(this.prisma, userId);
    const { count } = await this.prisma.shoppingItem.deleteMany({ where: { id, ...scope } });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
  }

  async clear(userId: string, checkedOnly: boolean): Promise<void> {
    const scope = await ownerScope(this.prisma, userId);
    await this.prisma.shoppingItem.deleteMany({
      where: { ...scope, ...(checkedOnly ? { checked: true } : {}) },
    });
  }

  /** Kupione (odhaczone) składniki trafiają do lodówki i znikają z listy */
  async toPantry(userId: string): Promise<{ moved: number }> {
    const scope = await ownerScope(this.prisma, userId);
    const checked = await this.prisma.shoppingItem.findMany({
      where: { ...scope, checked: true, ingredientId: { not: null } },
    });
    for (const item of checked) await this.pantry.addGrams(scope, item.ingredientId!, item.grams);
    await this.prisma.shoppingItem.deleteMany({ where: { id: { in: checked.map((i) => i.id) } } });
    return { moved: checked.length };
  }

  // ---------------------------------------------------------------------------

  /** Przepisy z podprzepisami (wszerz), w kształcie potrzebnym do rozwijania */
  private async loadRecipes(rootIds: string[]): Promise<Map<string, RecipeForShopping>> {
    const out = new Map<string, RecipeForShopping>();
    let frontier = [...new Set(rootIds)];
    for (let depth = 0; frontier.length && depth < 8; depth++) {
      const rows = await this.prisma.recipe.findMany({
        where: { id: { in: frontier } },
        select: {
          id: true,
          totalGrams: true,
          ingredients: { select: { ingredientId: true, subRecipeId: true, grams: true } },
        },
      });
      for (const r of rows) out.set(r.id, { totalGrams: r.totalGrams, lines: r.ingredients });
      frontier = [
        ...new Set(rows.flatMap((r) => r.ingredients.flatMap((l) => (l.subRecipeId ? [l.subRecipeId] : [])))),
      ].filter((id) => !out.has(id));
    }
    return out;
  }

  /** Odejmuje lodówkę i dopisuje resztę do listy */
  private async merge(scope: OwnerScope, need: Map<string, number>): Promise<AddResult> {
    const stock = await this.pantry.stock(scope);
    const skipped: string[] = [];
    let added = 0;
    for (const [ingredientId, grams] of need) {
      const have = stock.get(ingredientId);
      // Wpis "mam" bez ilości - nie kupujemy, ale informujemy
      const left = have === undefined ? grams : have === null ? 0 : grams - have;
      if (left < MIN_GRAMS) {
        skipped.push(ingredientId);
        continue;
      }
      await this.addGrams(scope, ingredientId, left, null);
      added++;
    }
    const inPantry = skipped.length
      ? await this.prisma.ingredient.findMany({
          where: { id: { in: skipped } },
          select: { id: true, namePl: true, nameEn: true },
          orderBy: { namePl: 'asc' },
        })
      : [];
    return { added, inPantry };
  }

  /** Dopisuje gramy do nieodhaczonej pozycji tego składnika albo tworzy nową */
  private async addGrams(scope: OwnerScope, ingredientId: string, grams: number | null, note: string | null) {
    const existing = await this.prisma.shoppingItem.findFirst({
      where: { ...scope, ingredientId, checked: false },
    });
    if (existing) {
      const total =
        existing.grams === null || grams === null ? (existing.grams ?? grams) : existing.grams + grams;
      await this.prisma.shoppingItem.update({
        where: { id: existing.id },
        data: { grams: total, ...(note ? { note } : {}) },
      });
      return existing.id;
    }
    const row = await this.prisma.shoppingItem.create({ data: { ...scope, ingredientId, grams, note } });
    return row.id;
  }
}

function toDto(r: Row) {
  const ing = r.ingredient;
  return {
    id: r.id,
    ingredient: ing
      ? {
          id: ing.id,
          namePl: ing.namePl,
          nameEn: ing.nameEn,
          category: {
            code: ing.category.code,
            namePl: ing.category.namePl,
            nameEn: ing.category.nameEn,
            icon: ing.category.icon,
            sortOrder: ing.category.sortOrder,
          },
        }
      : null,
    name: r.name,
    note: r.note,
    grams: r.grams,
    /** Ilość do kupienia w czytelnej formie (sztuki / ml / g) */
    amount:
      ing && r.grams !== null
        ? shoppingAmount(r.grams, {
            pieceGrams: ing.units.find((u) => u.unitCode === 'PIECE')?.grams ?? null,
            density: ing.density,
            liquid: LIQUID_CATEGORIES.has(ing.category.code),
          })
        : null,
    checked: r.checked,
    checkedBy: r.checkedBy?.username ?? null,
    updatedAt: r.updatedAt,
  };
}
