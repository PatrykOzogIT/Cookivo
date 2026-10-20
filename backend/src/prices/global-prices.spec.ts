import { globalPrice, isStale, median, robustMedian, type Observation } from './global-prices.js';

const day = (n: number) => new Date(Date.UTC(2026, 9, 20) - n * 24 * 60 * 60 * 1000);
const obs = (centsPerGram: number, storeKey = 'biedronka', ago = 1): Observation => ({
  ingredientId: 'mleko',
  storeKey,
  centsPerGram,
  on: day(ago),
});

describe('ceny ogólne', () => {
  it('mediana: nieparzysta, parzysta, pusta', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('ceny ponad 3× od mediany odpadają (pomyłka odczytu nie psuje ceny wszystkim)', () => {
    expect(robustMedian([0.33, 0.32, 0.34, 3.3])).toEqual({ value: 0.33, kept: 3 });
    expect(robustMedian([0.3])).toEqual({ value: 0.3, kept: 1 });
  });

  it('najpierw ta sama sieć sklepów, bez niej - wszystkie; najświeższa data z puli', () => {
    const all = [obs(0.3, 'biedronka', 10), obs(0.4, 'lidl', 2), obs(0.32, 'biedronka', 3)];
    expect(globalPrice(all, 'biedronka')).toMatchObject({
      centsPerGram: 0.31,
      count: 2,
      storeKey: 'biedronka',
    });
    expect(globalPrice(all, 'biedronka')!.latest).toEqual(day(3));
    expect(globalPrice(all, 'zabka')).toMatchObject({ centsPerGram: 0.32, count: 3, storeKey: null });
    expect(globalPrice([], '')).toBeNull();
  });

  it('podpowiedź aktualizacji: własna ponad 90 dni, ogólna świeża, różnica ponad 10%', () => {
    const now = day(0);
    const global = globalPrice([obs(0.33, 'biedronka', 5)], 'biedronka')!;
    expect(isStale({ centsPerGram: 0.29, updatedAt: day(120) }, global, now)).toBe(true);
    // Świeża własna cena - nie ruszamy
    expect(isStale({ centsPerGram: 0.29, updatedAt: day(30) }, global, now)).toBe(false);
    // Różnica 3% - nie warto
    expect(isStale({ centsPerGram: 0.32, updatedAt: day(120) }, global, now)).toBe(false);
  });
});
