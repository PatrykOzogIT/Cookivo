import type { PrismaService } from '../prisma/prisma.service.js';
import { expandRecipe, type RecipeForShopping } from './shopping-math.js';

/** Przepisy z podprzepisami (wszerz), w kształcie potrzebnym do rozwijania na składniki */
export async function loadRecipesForExpansion(
  prisma: PrismaService,
  rootIds: string[],
): Promise<Map<string, RecipeForShopping>> {
  const out = new Map<string, RecipeForShopping>();
  let frontier = [...new Set(rootIds)];
  for (let depth = 0; frontier.length && depth < 8; depth++) {
    const rows = await prisma.recipe.findMany({
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

/** Gramy składników na partie przepisów: [{ recipeId, factor }] (factor = porcje / porcje przepisu) */
export async function ingredientNeeds(
  prisma: PrismaService,
  batches: { recipeId: string; factor: number }[],
): Promise<Map<string, number>> {
  const recipes = await loadRecipesForExpansion(
    prisma,
    batches.map((b) => b.recipeId),
  );
  const need = new Map<string, number>();
  for (const b of batches) expandRecipe(b.recipeId, b.factor, recipes, need);
  return need;
}
