import { describe, expect, it } from 'vitest';
import { toPer100, type LabelValues } from './label-math.js';

const v = (values: Partial<LabelValues['values']>, extra: Partial<LabelValues> = {}): LabelValues => ({
  basis: 'PER_100G',
  portionAmount: null,
  kj: null,
  values: {
    kcal: null,
    protein: null,
    fat: null,
    saturatedFat: null,
    carbs: null,
    sugars: null,
    fiber: null,
    salt: null,
    ...values,
  },
  ...extra,
});

describe('toPer100', () => {
  it('wartości na 100 g bez zmian, braki zostają null', () => {
    const r = toPer100(v({ kcal: 61, protein: 4.3, fat: 2, carbs: 6.4, sugars: 6.4 }));
    expect(r.values).toMatchObject({
      kcal: 61,
      protein: 4.3,
      fat: 2,
      carbs: 6.4,
      sugars: 6.4,
      salt: null,
      fiber: null,
    });
    expect(r.missing).toEqual([]);
    expect(r.problem).toBeNull();
  });

  it('tylko na porcję: przeliczenie, gdy widać wielkość porcji; inaczej puste', () => {
    const r = toPer100(
      v({ kcal: 120, protein: 3, fat: 4, carbs: 18 }, { basis: 'PER_PORTION', portionAmount: 30 }),
    );
    expect(r.values).toMatchObject({ kcal: 400, protein: 10, fat: 13.33, carbs: 60 });
    expect(r.fromPortion).toBe(true);
    const unknown = toPer100(v({ kcal: 120 }, { basis: 'PER_PORTION' }));
    expect(unknown.portionUnknown).toBe(true);
    expect(unknown.values.kcal).toBeNull();
    expect(unknown.missing).toEqual(['kcal', 'protein', 'fat', 'carbs']);
  });

  it('energia tylko w kJ, 100 ml, brak tabeli', () => {
    expect(toPer100(v({ protein: 1, fat: 1, carbs: 10 }, { kj: 1046 })).values.kcal).toBe(250);
    expect(toPer100(v({ kcal: 46 }, { basis: 'PER_100ML' })).perMl).toBe(true);
    expect(toPer100(v({ kcal: 46 }, { basis: 'NONE' })).values.kcal).toBeNull();
  });

  it('niespójność i wartości spoza zakresu', () => {
    expect(toPer100(v({ kcal: 50, protein: 1, fat: 1, carbs: 5, sugars: 9 })).problem).toBe(
      'NUTRITION_SUGARS_GT_CARBS',
    );
    // 120 g białka na 100 g to błąd odczytu - pole zostaje puste
    expect(toPer100(v({ kcal: 50, protein: 120, fat: 1, carbs: 5 })).missing).toEqual(['protein']);
  });
});
