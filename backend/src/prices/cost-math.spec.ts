import { costOf, normalizePackageUnit, unitPrice } from './cost-math.js';

describe('koszt składników', () => {
  it('sumuje wycenione i wskazuje brakujące ceny', () => {
    // Mleko 4,29 zł / 1030 g, mąka 3,49 zł / 1000 g
    const prices = new Map([
      ['mleko', 429 / 1030],
      ['maka', 349 / 1000],
    ]);
    const need = new Map([
      ['mleko', 515],
      ['maka', 250],
      ['jajko', 100],
    ]);
    expect(costOf(need, prices)).toEqual({ cents: 302, priced: 2, missing: ['jajko'] });
  });

  it('pusta potrzeba = 0', () => {
    expect(costOf(new Map(), new Map())).toEqual({ cents: 0, priced: 0, missing: [] });
  });
});

describe('opakowania i ceny jednostkowe', () => {
  it('kg i l na g i ml, reszta bez zmian', () => {
    expect(normalizePackageUnit(1.5, 'kg')).toEqual({ amount: 1500, unitCode: 'g' });
    expect(normalizePackageUnit(1, 'l')).toEqual({ amount: 1000, unitCode: 'ml' });
    expect(normalizePackageUnit(10, 'PIECE')).toEqual({ amount: 10, unitCode: 'PIECE' });
  });

  it('za sztukę, za litr, za kilogram', () => {
    // Jajka 10 szt. (500 g) - 12,99 zł → 1,30 zł/szt.
    expect(
      unitPrice({ priceCents: 1299, packageGrams: 500 }, { density: null, pieceGrams: 50, liquid: false }),
    ).toEqual({ cents: 130, per: 'PIECE' });
    // Mleko 1 l (1030 g) - 4,29 zł → 4,29 zł/l
    expect(
      unitPrice({ priceCents: 429, packageGrams: 1030 }, { density: 1.03, pieceGrams: null, liquid: true }),
    ).toEqual({ cents: 429, per: 'l' });
    // Mąka 1 kg - 3,49 zł
    expect(
      unitPrice({ priceCents: 349, packageGrams: 1000 }, { density: null, pieceGrams: null, liquid: false }),
    ).toEqual({ cents: 349, per: 'kg' });
  });
});
