/**
 * Czyste funkcje liczące przepis: gramatura pozycji i wartości odżywcze.
 * Wszystko jest tu bez bazy danych, żeby dało się to dokładnie przetestować.
 */

export const NUTRIENTS = [
  'kcal',
  'protein',
  'fat',
  'saturatedFat',
  'carbs',
  'sugars',
  'fiber',
  'salt',
] as const;
export type NutrientKey = (typeof NUTRIENTS)[number];
/** Pola zawsze znane (dla składnika wymagane) */
const REQUIRED: readonly NutrientKey[] = ['kcal', 'protein', 'fat', 'carbs'];

export type NutritionValues = Record<NutrientKey, number | null>;

export interface IngredientForMath {
  nutrition: NutritionValues; // na 100 g
  density: number | null;
  /** gramy na jednostkę kuchenną zdefiniowaną przy składniku */
  units: Record<string, number>;
}

export interface SubRecipeForMath {
  servings: number;
  totalGrams: number;
  cookedGrams: number | null;
  /** sumy dla całego podprzepisu */
  totals: NutritionValues;
}

export type UnitProblem = 'UNIT_NOT_ALLOWED';

/** Waga gotowej potrawy: podana przez autora albo suma składników. */
export function effectiveGrams(r: { totalGrams: number; cookedGrams: number | null }): number {
  return r.cookedGrams && r.cookedGrams > 0 ? r.cookedGrams : r.totalGrams;
}

/**
 * Ile gramów to `amount` w danej jednostce.
 * Składnik: g, ml (z gęstością), jednostka zdefiniowana przy składniku
 * albo jednostka objętościowa (łyżka = 15 ml) przeliczona gęstością.
 * Podprzepis: g albo SERVING (porcja gotowej potrawy).
 */
export function gramsFor(
  amount: number,
  unitCode: string,
  item: { ingredient: IngredientForMath } | { subRecipe: SubRecipeForMath },
  unitMl: Record<string, number | null>,
): number | UnitProblem {
  if (unitCode === 'g') return amount;

  if ('subRecipe' in item) {
    if (unitCode !== 'SERVING') return 'UNIT_NOT_ALLOWED';
    const r = item.subRecipe;
    return (amount * effectiveGrams(r)) / Math.max(1, r.servings);
  }

  const { density, units } = item.ingredient;
  if (unitCode === 'ml') return density ? amount * density : 'UNIT_NOT_ALLOWED';
  if (units[unitCode] !== undefined) return amount * units[unitCode];
  const ml = unitMl[unitCode];
  if (ml && density) return amount * ml * density;
  return 'UNIT_NOT_ALLOWED';
}

export interface LineForMath {
  grams: number;
  ingredient?: IngredientForMath;
  subRecipe?: SubRecipeForMath;
}

/**
 * Sumy wartości dla całego przepisu. Pole opcjonalne staje się null ("brak danych"),
 * jeśli brakuje go w którejkolwiek pozycji o niezerowej wadze - nie udajemy zera.
 */
export function sumNutrition(lines: LineForMath[]): NutritionValues {
  const totals = Object.fromEntries(NUTRIENTS.map((k) => [k, 0])) as NutritionValues;
  for (const line of lines) {
    if (line.grams <= 0) continue;
    let values: NutritionValues;
    let factor: number;
    if (line.ingredient) {
      values = line.ingredient.nutrition;
      factor = line.grams / 100;
    } else if (line.subRecipe) {
      values = line.subRecipe.totals;
      factor = line.grams / Math.max(1e-9, effectiveGrams(line.subRecipe));
    } else {
      continue;
    }
    for (const key of NUTRIENTS) {
      const v = values[key];
      const acc = totals[key];
      if (v === null || acc === null) {
        totals[key] = REQUIRED.includes(key) ? (acc ?? 0) : null;
      } else {
        totals[key] = acc + v * factor;
      }
    }
  }
  return totals;
}

export function scaleNutrition(n: NutritionValues, factor: number, digits = 1): NutritionValues {
  const round = (v: number) => Math.round(v * 10 ** digits) / 10 ** digits;
  return Object.fromEntries(
    NUTRIENTS.map((k) => [k, n[k] === null ? null : round((n[k] as number) * factor)]),
  ) as NutritionValues;
}

/** Wartości na 100 g gotowej potrawy i na porcję. */
export function derivedNutrition(r: {
  totals: NutritionValues;
  totalGrams: number;
  cookedGrams: number | null;
  servings: number;
}) {
  const grams = effectiveGrams(r);
  return {
    per100g: grams > 0 ? scaleNutrition(r.totals, 100 / grams) : null,
    perServing: scaleNutrition(r.totals, 1 / Math.max(1, r.servings)),
    servingGrams: Math.round((grams / Math.max(1, r.servings)) * 10) / 10,
    /** true = liczone z sumy surowych składników, więc na 100 g jest przybliżeniem */
    approximate: !(r.cookedGrams && r.cookedGrams > 0),
  };
}
