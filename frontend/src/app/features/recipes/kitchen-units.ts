import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { parseDecimal } from '../../core/i18n/format.pipes';

/**
 * Miary kuchenne zawsze dostępne w formularzu przepisu i rozsądne wagi 1 miary w gramach.
 * Zdublowane z `backend/src/ingredients/kitchen-units.ts` - zmieniać razem.
 */
export const KITCHEN_UNITS = ['TEASPOON', 'TABLESPOON', 'GLASS', 'PINCH', 'PIECE'] as const;

export const UNIT_RANGES: Record<string, [number, number]> = {
  TEASPOON: [0.5, 15],
  TABLESPOON: [1.5, 45],
  GLASS: [30, 450],
  PINCH: [0.05, 2],
  PIECE: [0.3, 5000],
};

/** Waga 1 miary w zakresie (polski przecinek dozwolony) */
export function unitGramsValidator(range: [number, number]): ValidatorFn {
  return (c: AbstractControl): ValidationErrors | null => {
    const raw = String(c.value ?? '').trim();
    if (!raw) return null;
    const v = parseDecimal(raw);
    return v !== null && !Number.isNaN(v) && v >= range[0] && v <= range[1] ? null : { unitGrams: { range } };
  };
}
