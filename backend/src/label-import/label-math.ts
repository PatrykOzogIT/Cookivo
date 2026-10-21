import { checkNutrition, type NutritionProblem } from '../ingredients/nutrition.js';

/**
 * Wartości z etykiety → wartości na 100 g dla formularza składnika. Niczego nie zgadujemy:
 * czego nie odczytano, zostaje null (formularz pokazuje, co trzeba uzupełnić).
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
export const REQUIRED: NutrientKey[] = ['kcal', 'protein', 'fat', 'carbs'];

/** Na co podano wartości na etykiecie */
export type LabelBasis = 'PER_100G' | 'PER_100ML' | 'PER_PORTION' | 'NONE';

export interface LabelValues {
  basis: LabelBasis;
  /** Wielkość porcji w g lub ml (gdy wartości są tylko na porcję) */
  portionAmount: number | null;
  /** Energia w kJ, gdy na etykiecie nie ma kcal */
  kj: number | null;
  values: Record<NutrientKey, number | null>;
}

export interface Per100 {
  values: Record<NutrientKey, number | null>;
  /** Wartości podane na 100 ml - przeliczone jak na 100 g (gęstość ~1, do sprawdzenia) */
  perMl: boolean;
  /** Przeliczone z porcji */
  fromPortion: boolean;
  /** Wymagane pola bez wartości */
  missing: NutrientKey[];
  /** Wartości tylko na porcję, a wielkości porcji nie widać */
  portionUnknown: boolean;
  /** Niespójność (te same reguły co formularz), np. cukry > węglowodany */
  problem: NutritionProblem | null;
}

const KJ_PER_KCAL = 4.184;

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function sane(n: number | null, max: number): number | null {
  return n === null || !Number.isFinite(n) || n < 0 || n > max ? null : n;
}

export function toPer100(label: LabelValues): Per100 {
  const empty = Object.fromEntries(NUTRIENTS.map((k) => [k, null])) as Record<NutrientKey, number | null>;
  let factor: number | null = 1;
  const fromPortion = label.basis === 'PER_PORTION';
  if (label.basis === 'NONE') factor = null;
  if (fromPortion) factor = label.portionAmount && label.portionAmount > 0 ? 100 / label.portionAmount : null;

  const values = { ...empty };
  if (factor !== null) {
    for (const k of NUTRIENTS) {
      const v = label.values[k];
      if (v === null || v === undefined) continue;
      values[k] = sane(v * factor, k === 'kcal' ? 900 : 100);
    }
    // Sama energia w kJ (np. tylko "1046 kJ") - przeliczamy na kcal
    if (values.kcal === null && label.kj !== null && label.kj > 0)
      values.kcal = sane((label.kj * factor) / KJ_PER_KCAL, 900);
  }
  for (const k of NUTRIENTS) {
    if (values[k] !== null) values[k] = k === 'kcal' ? round(values[k]!, 1) : round(values[k]!, 2);
  }

  const missing = REQUIRED.filter((k) => values[k] === null);
  const problem = missing.length
    ? null
    : checkNutrition({
        kcal: values.kcal!,
        protein: values.protein!,
        fat: values.fat!,
        carbs: values.carbs!,
        saturatedFat: values.saturatedFat,
        sugars: values.sugars,
        fiber: values.fiber,
        salt: values.salt,
      });
  return {
    values,
    perMl: label.basis === 'PER_100ML',
    fromPortion: fromPortion && factor !== null,
    missing,
    portionUnknown: fromPortion && factor === null,
    problem,
  };
}
