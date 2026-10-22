/** Wspólne typy importu składników (ETL: źródła → kandydaci → plik importowy → baza) */

export type Source = 'CIQUAL' | 'USDA';

export const NUTRIENT_KEYS = [
  'kcal',
  'protein',
  'fat',
  'saturatedFat',
  'carbs',
  'sugars',
  'fiber',
  'salt',
] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];
export const REQUIRED_NUTRIENTS: NutrientKey[] = ['kcal', 'protein', 'fat', 'carbs'];

/** Wartości na 100 g w standardzie etykiety UE; null = brak danych w źródle (nigdy 0) */
export type Nutrition = Record<NutrientKey, number | null>;

/** Jednostki kuchenne Cookivo, które da się wiarygodnie wyprowadzić ze źródeł */
export type PortionUnit = 'PIECE' | 'SLICE' | 'CLOVE' | 'TEASPOON' | 'TABLESPOON' | 'GLASS';

export interface Portion {
  unit: PortionUnit;
  grams: number;
  /** Opis porcji w źródle (np. "cup, chopped") - do raportu */
  label: string;
}

/** Produkt ze źródła po odczycie i normalizacji wartości */
export interface SourceFood {
  /** Stabilny klucz: "ciqual:20917", "usda:170379" */
  key: string;
  source: Source;
  ref: string;
  nameEn: string;
  nameFr: string | null;
  /** Kod grupy w źródle (Ciqual: podgrupa "0201", USDA: kategoria "1100") */
  group: string;
  groupName: string;
  values: Nutrition;
  portions: Portion[];
}

/** Powód odrzucenia na etapie selekcji */
export type RejectReason =
  | 'GROUP_EXCLUDED'
  | 'BRANDED'
  | 'MISSING_REQUIRED'
  | 'TECHNICAL_VARIANT'
  | 'DUPLICATE_IN_SOURCE'
  | 'DUPLICATE_OF_CIQUAL';
