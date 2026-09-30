import { potGrams, splitMeal } from './portions.js';

describe('waga garnka', () => {
  const recipe = { servings: 4, cookedGrams: 1600, totalGrams: 2000 };

  it('zważona wygrywa, potem waga z przepisu przeskalowana na partię, potem surowe składniki', () => {
    expect(potGrams({ servings: 4, cookedGrams: 1850 }, recipe)).toEqual({ grams: 1850, source: 'WEIGHED' });
    expect(potGrams({ servings: 6, cookedGrams: null }, recipe)).toEqual({ grams: 2400, source: 'RECIPE' });
    expect(potGrams({ servings: 2, cookedGrams: null }, { ...recipe, cookedGrams: null })).toEqual({
      grams: 1000,
      source: 'ESTIMATE',
    });
    expect(
      potGrams({ servings: 2, cookedGrams: null }, { servings: 2, cookedGrams: null, totalGrams: 0 }),
    ).toEqual({ grams: null, source: null });
  });
});

describe('podział posiłku', () => {
  const family = [
    { key: 'u:tata', kcal: 2600 },
    { key: 'u:mama', kcal: 1900 },
    { key: 'd:ola', kcal: 1600 },
  ];

  it('proporcjonalnie do celów kcal (przykład z planu: 42% / 31% / 27%)', () => {
    const shares = splitMeal(family, new Set(), { servings: 3, grams: 1850, kcalPerServing: 490 });
    expect(shares.map((s) => Math.round(s.fraction * 100))).toEqual([43, 31, 26]);
    expect(shares.reduce((a, s) => a + s.fraction, 0)).toBeCloseTo(1);
    expect(shares[0].grams).toBe(789);
    expect(shares.reduce((a, s) => a + s.servings, 0)).toBeCloseTo(3);
  });

  it('nieobecni nie dostają porcji, reszta dzieli się całością', () => {
    const shares = splitMeal(family, new Set(['d:ola']), { servings: 2, grams: null, kcalPerServing: 500 });
    expect(shares.map((s) => s.key)).toEqual(['u:tata', 'u:mama']);
    expect(shares[0].grams).toBeNull();
    expect(shares.reduce((a, s) => a + s.kcal, 0)).toBe(1000);
  });

  it('nikt nie je - brak podziału', () => {
    expect(
      splitMeal(family, new Set(family.map((p) => p.key)), { servings: 1, grams: 500, kcalPerServing: 1 }),
    ).toEqual([]);
  });
});
