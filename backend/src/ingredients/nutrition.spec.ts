import { normalizeSearch } from '../common/text.js';
import { checkNutrition, estimateKcal } from './nutrition.js';

const base = { kcal: 100, protein: 10, fat: 5, carbs: 20 };

describe('checkNutrition', () => {
  it('akceptuje spójne wartości', () => {
    expect(checkNutrition({ ...base, saturatedFat: 2, sugars: 5, fiber: 3, salt: 1 })).toBeNull();
  });

  it('akceptuje brak danych (null) w polach opcjonalnych', () => {
    expect(checkNutrition({ ...base, saturatedFat: null, sugars: null, fiber: null })).toBeNull();
  });

  it('odrzuca więcej niż 100 g składników na 100 g (z tolerancją 1 g)', () => {
    expect(checkNutrition({ kcal: 900, protein: 0, fat: 100, carbs: 0.9 })).toBeNull();
    expect(checkNutrition({ kcal: 500, protein: 40, fat: 40, carbs: 20, fiber: 5 })).toBe(
      'NUTRITION_OVER_100G',
    );
  });

  it('odrzuca tłuszcze nasycone większe niż tłuszcz', () => {
    expect(checkNutrition({ ...base, saturatedFat: 6 })).toBe('NUTRITION_SATFAT_GT_FAT');
  });

  it('odrzuca cukry większe niż węglowodany', () => {
    expect(checkNutrition({ ...base, sugars: 25 })).toBe('NUTRITION_SUGARS_GT_CARBS');
  });
});

describe('estimateKcal', () => {
  it('liczy energię wg współczynników UE (4/9/4/2)', () => {
    expect(estimateKcal({ protein: 10, fat: 10, carbs: 10, fiber: 5 })).toBe(40 + 90 + 40 + 10);
  });
});

describe('normalizeSearch', () => {
  it('usuwa polskie znaki, wielkie litery i interpunkcję', () => {
    expect(normalizeSearch('Żółty Ser, 45%!')).toBe('zolty ser 45%');
    expect(normalizeSearch('  Mąka   pszenna (typ 650) ')).toBe('maka pszenna typ 650');
    expect(normalizeSearch('Łosoś')).toBe('losos');
  });
});
