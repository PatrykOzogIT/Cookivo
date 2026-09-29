export interface Nutrition {
  kcal: number;
  protein: number;
  fat: number;
  saturatedFat?: number | null;
  carbs: number;
  sugars?: number | null;
  fiber?: number | null;
  salt?: number | null;
}

export type NutritionProblem =
  'NUTRITION_OVER_100G' | 'NUTRITION_SATFAT_GT_FAT' | 'NUTRITION_SUGARS_GT_CARBS';

/** Tolerancja na zaokrąglenia w danych z etykiet */
const TOLERANCE_G = 1;

/**
 * Spójność wartości na 100 g. Nie sprawdzamy kalorii "na sztywno" - różne źródła liczą
 * energię różnymi współczynnikami; rozbieżność pokazuje tylko ostrzeżenie w formularzu.
 */
export function checkNutrition(n: Nutrition): NutritionProblem | null {
  if (n.protein + n.fat + n.carbs + (n.fiber ?? 0) > 100 + TOLERANCE_G) return 'NUTRITION_OVER_100G';
  if (n.saturatedFat != null && n.saturatedFat > n.fat + 0.1) return 'NUTRITION_SATFAT_GT_FAT';
  if (n.sugars != null && n.sugars > n.carbs + 0.1) return 'NUTRITION_SUGARS_GT_CARBS';
  return null;
}

/** Energia wg współczynników UE (rozporządzenie 1169/2011, zał. XIV). */
export function estimateKcal(n: Pick<Nutrition, 'protein' | 'fat' | 'carbs' | 'fiber'>): number {
  return 4 * n.protein + 9 * n.fat + 4 * n.carbs + 2 * (n.fiber ?? 0);
}
