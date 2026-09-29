import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  gramsFor,
  sumNutrition,
  type IngredientForMath,
  type LineForMath,
  type NutritionValues,
  type SubRecipeForMath,
} from './recipe-math.js';

type Tx = Prisma.TransactionClient;

const LINE_INCLUDE = {
  ingredient: { include: { units: true, allergens: true } },
  subRecipe: { include: { allergens: true } },
} satisfies Prisma.RecipeIngredientInclude;

export function ingredientForMath(i: {
  kcal: number;
  protein: number;
  fat: number;
  saturatedFat: number | null;
  carbs: number;
  sugars: number | null;
  fiber: number | null;
  salt: number | null;
  density: number | null;
  units: { unitCode: string; grams: number }[];
}): IngredientForMath {
  return {
    nutrition: {
      kcal: i.kcal,
      protein: i.protein,
      fat: i.fat,
      saturatedFat: i.saturatedFat,
      carbs: i.carbs,
      sugars: i.sugars,
      fiber: i.fiber,
      salt: i.salt,
    },
    density: i.density,
    units: Object.fromEntries(i.units.map((u) => [u.unitCode, u.grams])),
  };
}

export function subRecipeForMath(r: {
  servings: number;
  totalGrams: number;
  cookedGrams: number | null;
  kcal: number;
  protein: number;
  fat: number;
  saturatedFat: number | null;
  carbs: number;
  sugars: number | null;
  fiber: number | null;
  salt: number | null;
}): SubRecipeForMath {
  return {
    servings: r.servings,
    totalGrams: r.totalGrams,
    cookedGrams: r.cookedGrams,
    totals: {
      kcal: r.kcal,
      protein: r.protein,
      fat: r.fat,
      saturatedFat: r.saturatedFat,
      carbs: r.carbs,
      sugars: r.sugars,
      fiber: r.fiber,
      salt: r.salt,
    },
  };
}

/**
 * Przelicza zapisane w przepisie sumy (waga, wartości odżywcze, alergeny)
 * i propaguje zmiany do przepisów, które używają go jako składnika.
 * Wywoływany po zapisie przepisu oraz po zmianie składnika z bazy.
 */
@Injectable()
export class RecipeCalculatorService {
  constructor(private readonly prisma: PrismaService) {}

  async unitMl(tx: Tx = this.prisma): Promise<Record<string, number | null>> {
    return Object.fromEntries((await tx.unit.findMany()).map((u) => [u.code, u.ml]));
  }

  /** Przelicza jeden przepis. Gramatura pozycji jest odświeżana (np. gdy zmienił się przelicznik składnika). */
  async recalculate(recipeId: string, tx: Tx = this.prisma): Promise<void> {
    const recipe = await tx.recipe.findUnique({
      where: { id: recipeId },
      include: { ingredients: { include: LINE_INCLUDE } },
    });
    if (!recipe) return;
    const unitMl = await this.unitMl(tx);

    const lines: LineForMath[] = [];
    const allergenIds = new Set<number>();
    for (const line of recipe.ingredients) {
      let grams = line.grams;
      if (line.ingredient) {
        const ingredient = ingredientForMath(line.ingredient);
        const g = gramsFor(line.amount, line.unitCode, { ingredient }, unitMl);
        if (typeof g === 'number') grams = g;
        lines.push({ grams, ingredient });
        line.ingredient.allergens.forEach((a) => allergenIds.add(a.allergenId));
      } else if (line.subRecipe) {
        const subRecipe = subRecipeForMath(line.subRecipe);
        const g = gramsFor(line.amount, line.unitCode, { subRecipe }, unitMl);
        if (typeof g === 'number') grams = g;
        lines.push({ grams, subRecipe });
        line.subRecipe.allergens.forEach((a) => allergenIds.add(a.allergenId));
      }
      if (grams !== line.grams) {
        await tx.recipeIngredient.update({ where: { id: line.id }, data: { grams } });
      }
    }

    const totals: NutritionValues = sumNutrition(lines);
    const totalGrams = lines.reduce((sum, l) => sum + l.grams, 0);
    const round = (v: number | null, d = 1) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

    await tx.recipe.update({
      where: { id: recipeId },
      data: {
        totalGrams: round(totalGrams)!,
        kcal: round(totals.kcal)!,
        protein: round(totals.protein)!,
        fat: round(totals.fat)!,
        saturatedFat: round(totals.saturatedFat),
        carbs: round(totals.carbs)!,
        sugars: round(totals.sugars),
        fiber: round(totals.fiber),
        salt: round(totals.salt, 2),
        kcalPerServing: round((totals.kcal ?? 0) / Math.max(1, recipe.servings))!,
      },
    });
    await tx.recipeAllergen.deleteMany({ where: { recipeId } });
    if (allergenIds.size) {
      await tx.recipeAllergen.createMany({
        data: [...allergenIds].map((allergenId) => ({ recipeId, allergenId })),
      });
    }
  }

  /** Przelicza przepisy, które używają danego przepisu jako składnika (rekurencyjnie w górę). */
  async recalculateUpstream(
    recipeId: string,
    tx: Tx = this.prisma,
    visited = new Set<string>(),
  ): Promise<void> {
    visited.add(recipeId);
    const parents = await tx.recipeIngredient.findMany({
      where: { subRecipeId: recipeId },
      select: { recipeId: true },
      distinct: ['recipeId'],
    });
    for (const { recipeId: parentId } of parents) {
      if (visited.has(parentId)) continue;
      await this.recalculate(parentId, tx);
      await this.recalculateUpstream(parentId, tx, visited);
    }
  }

  /** Po zmianie składnika z bazy (wartości, alergeny, przeliczniki). */
  async recalculateForIngredient(ingredientId: string): Promise<void> {
    const users = await this.prisma.recipeIngredient.findMany({
      where: { ingredientId },
      select: { recipeId: true },
      distinct: ['recipeId'],
    });
    const visited = new Set<string>();
    for (const { recipeId } of users) {
      await this.recalculate(recipeId);
      await this.recalculateUpstream(recipeId, this.prisma, visited);
    }
  }
}
