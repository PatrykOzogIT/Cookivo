/**
 * Lista zakupów - czysta logika: rozwijanie przepisów (z podprzepisami) do składników
 * i czytelne ilości "kuchenne + gramy".
 */

export interface RecipeForShopping {
  totalGrams: number;
  lines: { ingredientId: string | null; subRecipeId: string | null; grams: number }[];
}

/** Zabezpieczenie przed cyklem (zapis przepisu już go blokuje) */
const MAX_DEPTH = 6;

/**
 * Dodaje do `acc` gramy składników potrzebne na `factor` × przepis.
 * Podprzepis (np. rosół w zupie) liczymy proporcjonalnie: użyte gramy / waga całego podprzepisu.
 */
export function expandRecipe(
  recipeId: string,
  factor: number,
  recipes: Map<string, RecipeForShopping>,
  acc: Map<string, number> = new Map(),
  depth = 0,
): Map<string, number> {
  const recipe = recipes.get(recipeId);
  if (!recipe || depth > MAX_DEPTH || factor <= 0) return acc;
  for (const line of recipe.lines) {
    if (line.ingredientId) {
      acc.set(line.ingredientId, (acc.get(line.ingredientId) ?? 0) + line.grams * factor);
    } else if (line.subRecipeId) {
      const sub = recipes.get(line.subRecipeId);
      if (sub && sub.totalGrams > 0) {
        expandRecipe(line.subRecipeId, factor * (line.grams / sub.totalGrams), recipes, acc, depth + 1);
      }
    }
  }
  return acc;
}

export type ShoppingUnit = 'PIECE' | 'g' | 'kg' | 'ml' | 'l';

export interface ShoppingAmount {
  amount: number;
  unit: ShoppingUnit;
  /** Gramy zawsze, do dopisku "(ok. 450 g)" */
  grams: number;
}

/** Zaokrąglenie w górę do "sklepowych" kroków: lepiej kupić odrobinę więcej niż za mało */
function roundUp(value: number, step: number): number {
  // Tolerancja 2% kroku: 1301 ml to jeszcze "1,3 l", a nie 1,4 l
  const steps = Math.ceil(value / step - 0.02);
  return Math.round(steps * step * 1000) / 1000;
}

/**
 * Ilość do kupienia: sztuki (gdy składnik ma wagę sztuki), objętość dla płynów
 * (gdy znamy gęstość), w pozostałych przypadkach gramy / kilogramy.
 */
export function shoppingAmount(
  grams: number,
  ingredient: { pieceGrams: number | null; density: number | null; liquid: boolean },
): ShoppingAmount {
  const g = Math.max(0, grams);
  if (ingredient.pieceGrams && ingredient.pieceGrams > 0) {
    return {
      amount: Math.max(1, Math.ceil(g / ingredient.pieceGrams - 0.05)),
      unit: 'PIECE',
      grams: Math.round(g),
    };
  }
  if (ingredient.liquid && ingredient.density && ingredient.density > 0) {
    const ml = g / ingredient.density;
    return ml >= 1000
      ? { amount: roundUp(ml / 1000, 0.1), unit: 'l', grams: Math.round(g) }
      : { amount: roundUp(ml, ml < 100 ? 5 : 10), unit: 'ml', grams: Math.round(g) };
  }
  return g >= 1000
    ? { amount: roundUp(g / 1000, 0.05), unit: 'kg', grams: Math.round(g) }
    : { amount: roundUp(g, g < 100 ? 5 : 10), unit: 'g', grams: Math.round(g) };
}

/** Kategorie, w których podajemy objętość (napoje, mleko, oleje) - reszta z gęstością to np. miód */
export const LIQUID_CATEGORIES = new Set(['BEVERAGES', 'DAIRY', 'FATS', 'SAUCES']);
