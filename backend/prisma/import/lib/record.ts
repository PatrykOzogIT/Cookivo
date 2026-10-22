import { checkNutrition } from '../../../src/ingredients/nutrition.js';
import { NUTRIENT_KEYS, REQUIRED_NUTRIENTS, type NutrientKey, type Source } from './types.js';

/** Jeden wiersz pliku importowego (ingredients.import.jsonl) - wszystko, czego potrzebuje baza */
export interface ImportRecord {
  importKey: string;
  /** Klucz w bazie - prefiks "import:" omija seed (wdrożenia go nie nadpisują) */
  seedKey: string;
  namePl: string;
  nameEn: string | null;
  categoryCode: string;
  status: 'APPROVED' | 'PENDING';
  source: Source;
  sourceRef: string;
  kcal: number;
  protein: number;
  fat: number;
  saturatedFat: number | null;
  carbs: number;
  sugars: number | null;
  fiber: number | null;
  salt: number | null;
  density: number | null;
  allergens: string[];
  /** Skąd alergeny: reguła z nazwy (pewna), AI (propozycja), brak */
  allergenBasis: 'RULE' | 'RULE_AND_AI' | 'AI';
  units: { code: string; grams: number; basis: 'SOURCE' | 'AI' | 'DENSITY' }[];
  relevance: 'COMMON' | 'OCCASIONAL';
  /** Puste wartości opcjonalne i pola uzupełnione z drugiego źródła */
  quality: { missing: NutrientKey[]; filledFrom: { field: string; key: string }[] };
  /** Powody weryfikacji (PENDING); puste = pewny rekord */
  review: string[];
  /** Scalone pozycje źródłowe (duplikaty) */
  duplicates: string[];
  /** Alergeny typowe dla rodzaju produktu (nie z etykiety konkretnego wyrobu) */
  allergensTypical?: boolean;
}

export const NAME_MAX = 120;

/** Walidacja wiersza - te same zasady co formularz i DTO składnika; zwraca listę błędów */
export function validateRecord(
  r: ImportRecord,
  categories: Set<string>,
  allergens: Set<string>,
  units: Set<string>,
): string[] {
  const errors: string[] = [];
  if (!r.namePl || r.namePl.trim().length < 2 || r.namePl.length > NAME_MAX) errors.push('NAME_PL');
  if (r.nameEn && r.nameEn.length > NAME_MAX) errors.push('NAME_EN');
  if (!categories.has(r.categoryCode)) errors.push('CATEGORY');
  for (const k of NUTRIENT_KEYS) {
    const v = r[k];
    if (v === null) {
      if (REQUIRED_NUTRIENTS.includes(k)) errors.push(`MISSING_${k}`);
      continue;
    }
    if (!Number.isFinite(v) || v < 0 || v > (k === 'kcal' ? 900 : 100)) errors.push(`RANGE_${k}`);
  }
  if (!errors.some((e) => e.startsWith('MISSING') || e.startsWith('RANGE'))) {
    const problem = checkNutrition({
      kcal: r.kcal,
      protein: r.protein,
      fat: r.fat,
      carbs: r.carbs,
      saturatedFat: r.saturatedFat,
      sugars: r.sugars,
      fiber: r.fiber,
      salt: r.salt,
    });
    if (problem) errors.push(problem);
  }
  if (r.density !== null && (r.density < 0.2 || r.density > 3)) errors.push('DENSITY');
  if (r.allergens.some((a) => !allergens.has(a))) errors.push('ALLERGEN');
  if (r.units.some((u) => !units.has(u.code) || !(u.grams > 0) || u.grams > 5000)) errors.push('UNIT');
  if (!r.seedKey.startsWith('import:')) errors.push('SEED_KEY');
  return errors;
}
