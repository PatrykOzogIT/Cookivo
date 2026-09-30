/**
 * Tryb dokładny planera: podział porcji między osoby proporcjonalnie do ich dziennego celu kcal
 * i przeliczenie na gramy z wagi garnka. Czysta logika - bez bazy.
 */

export type GramsSource = 'WEIGHED' | 'RECIPE' | 'ESTIMATE';

export interface Person {
  /** 'u:<id>' - domownik z kontem, 'd:<id>' - osoba bez konta */
  key: string;
  /** Waga przy podziale = dzienny cel kcal (albo wartość referencyjna) */
  kcal: number;
}

export interface Share {
  key: string;
  /** Udział w posiłku 0-1 */
  fraction: number;
  /** Ile porcji przepisu to jest */
  servings: number;
  /** Gramy na talerz (null, gdy nie znamy wagi) */
  grams: number | null;
  kcal: number;
}

/**
 * Waga całej partii po ugotowaniu: zważona > z przepisu (waga po ugotowaniu) > szacunek
 * z surowych składników (po gotowaniu zwykle mniej - zupa odparowuje, kasza wchłania wodę).
 */
export function potGrams(
  cook: { servings: number; cookedGrams: number | null },
  recipe: { servings: number; cookedGrams: number | null; totalGrams: number },
): { grams: number | null; source: GramsSource | null } {
  if (cook.cookedGrams) return { grams: cook.cookedGrams, source: 'WEIGHED' };
  const scale = recipe.servings > 0 ? cook.servings / recipe.servings : 0;
  if (recipe.cookedGrams) return { grams: recipe.cookedGrams * scale, source: 'RECIPE' };
  if (recipe.totalGrams > 0) return { grams: recipe.totalGrams * scale, source: 'ESTIMATE' };
  return { grams: null, source: null };
}

/** Dzieli posiłek między jedzących proporcjonalnie do ich celów kcal */
export function splitMeal(
  persons: Person[],
  absent: Set<string>,
  meal: { servings: number; grams: number | null; kcalPerServing: number },
): Share[] {
  const eaters = persons.filter((p) => !absent.has(p.key) && p.kcal > 0);
  const total = eaters.reduce((a, p) => a + p.kcal, 0);
  if (!total) return [];
  return eaters.map((p) => {
    const fraction = p.kcal / total;
    const servings = meal.servings * fraction;
    return {
      key: p.key,
      fraction,
      servings,
      grams: meal.grams === null ? null : Math.round(meal.grams * fraction),
      kcal: Math.round(meal.kcalPerServing * servings),
    };
  });
}
