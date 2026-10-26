import { checkEstimate, inUnitRange } from './kitchen-units.js';

describe('miary kuchenne', () => {
  it('zakresy wag', () => {
    expect(inUnitRange('TEASPOON', 6)).toBe(true);
    expect(inUnitRange('TEASPOON', 5000)).toBe(false);
    expect(inUnitRange('GLASS', 20)).toBe(false);
    expect(inUnitRange('g', 5)).toBe(false);
  });

  it('szacunek: wartości w zakresach, null = miara nie pasuje', () => {
    expect(checkEstimate({ TEASPOON: 6, TABLESPOON: 18, GLASS: 290, PINCH: 0.4, PIECE: null })).toEqual({
      grams: { TEASPOON: 6, TABLESPOON: 18, GLASS: 290, PINCH: 0.4 },
      notFit: ['PIECE'],
    });
    // Sztuka spoza zakresu przepada, reszta zostaje
    expect(checkEstimate({ PIECE: 9000, PINCH: 0.3 }).grams).toEqual({ PINCH: 0.3 });
  });

  it('niespójne łyżka / łyżeczka / szklanka - odrzucone wszystkie trzy', () => {
    expect(checkEstimate({ TEASPOON: 5, TABLESPOON: 40, GLASS: 300, PIECE: 50 }).grams).toEqual({
      PIECE: 50,
    });
    expect(checkEstimate({ TEASPOON: 3, TABLESPOON: 9, GLASS: 400 }).grams).toEqual({});
  });
});
