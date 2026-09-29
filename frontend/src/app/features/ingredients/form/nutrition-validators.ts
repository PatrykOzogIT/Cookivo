import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { parseDecimal } from '../../../core/i18n/format.pipes';

/** Liczba dziesiętna (przecinek lub kropka) z zakresu; puste pole przepuszcza (od tego jest `required`). */
export function decimalValidator(min: number, max: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = parseDecimal(control.value);
    if (value === null) return null;
    if (Number.isNaN(value)) return { decimal: true };
    if (value < min || value > max) return { range: { min, max } };
    return null;
  };
}

const TOLERANCE_G = 1;

/**
 * Walidacja spójności na poziomie grupy - te same reguły co na backendzie (nutrition.ts).
 * Błąd ustawiamy na grupie, żeby pokazać jeden czytelny komunikat.
 */
export const nutritionGroupValidator: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const v = (name: string) => parseDecimal(group.get(name)?.value);
  const [protein, fat, carbs, fiber, saturatedFat, sugars] = [
    v('protein'),
    v('fat'),
    v('carbs'),
    v('fiber'),
    v('saturatedFat'),
    v('sugars'),
  ];
  const num = (n: number | null) => (n === null || Number.isNaN(n) ? 0 : n);

  if (num(protein) + num(fat) + num(carbs) + num(fiber) > 100 + TOLERANCE_G)
    return { NUTRITION_OVER_100G: true };
  if (saturatedFat !== null && fat !== null && saturatedFat > fat + 0.1)
    return { NUTRITION_SATFAT_GT_FAT: true };
  if (sugars !== null && carbs !== null && sugars > carbs + 0.1) return { NUTRITION_SUGARS_GT_CARBS: true };
  return null;
};

/** Energia z makro wg współczynników UE: białko 4, tłuszcz 9, węglowodany 4, błonnik 2 kcal/g. */
export function estimateKcal(protein: number, fat: number, carbs: number, fiber: number): number {
  return 4 * protein + 9 * fat + 4 * carbs + 2 * fiber;
}

/** Ostrzeżenie (nie błąd), gdy podane kcal odbiegają od wyliczonych o >20% i >20 kcal. */
export function kcalMismatch(kcal: number, estimated: number): boolean {
  const diff = Math.abs(kcal - estimated);
  return diff > 20 && diff > 0.2 * Math.max(kcal, estimated);
}
