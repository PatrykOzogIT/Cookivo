import { purchaseDate, receiptLine, toCents, type ReadLine } from './receipt-math.js';

const line = (over: Partial<ReadLine>): ReadLine => ({
  quantity: null,
  quantityUnit: null,
  packageAmount: null,
  packageUnit: null,
  unitPrice: null,
  totalPrice: null,
  ...over,
});

describe('pozycje paragonu', () => {
  it('"MLEKO UHT 3,2% 1L 2 x 4,29" → 2 × 1 l po 4,29, razem 8,58', () => {
    expect(
      receiptLine(
        line({
          quantity: 2,
          quantityUnit: 'PIECE',
          packageAmount: 1,
          packageUnit: 'l',
          unitPrice: 4.29,
          totalPrice: 8.58,
        }),
      ),
    ).toEqual({
      packages: 2,
      packageAmount: 1,
      packageUnitCode: 'l',
      priceCents: 429,
      lineTotalCents: 858,
      warnings: [],
    });
  });

  it('towar na wagę: cena za kg zostaje ceną 1 kg, a nie ceną opakowania', () => {
    expect(
      receiptLine(line({ quantity: 0.734, quantityUnit: 'kg', unitPrice: 9.99, totalPrice: 7.33 })),
    ).toMatchObject({
      packages: 0.734,
      packageAmount: 1,
      packageUnitCode: 'kg',
      priceCents: 999,
      lineTotalCents: 733,
    });
    // Waga w gramach → kg; objętość w ml → l
    expect(receiptLine(line({ quantity: 350, quantityUnit: 'g', unitPrice: 20 }))).toMatchObject({
      packages: 0.35,
      packageUnitCode: 'kg',
    });
    expect(receiptLine(line({ quantity: 500, quantityUnit: 'ml', unitPrice: 8 }))).toMatchObject({
      packages: 0.5,
      packageUnitCode: 'l',
    });
  });

  it('ryż 500 g za 4,99: cena opakowania 4,99 (za kg policzy cennik), 1 sztuka bez mnożenia', () => {
    expect(receiptLine(line({ packageAmount: 500, packageUnit: 'g', totalPrice: 4.99 }))).toMatchObject({
      packages: 1,
      packageAmount: 500,
      packageUnitCode: 'g',
      priceCents: 499,
      warnings: [],
    });
  });

  it('brak gramatury i ceny - nie zgadujemy, tylko ostrzegamy', () => {
    expect(receiptLine(line({ quantity: 3, quantityUnit: 'PIECE' }))).toMatchObject({
      packages: 3,
      packageAmount: null,
      packageUnitCode: null,
      priceCents: null,
      lineTotalCents: null,
      warnings: ['NO_PACKAGE_SIZE', 'NO_PRICE'],
    });
  });

  it('cena za sztukę z wartości pozycji; niezgodna wartość = ostrzeżenie', () => {
    expect(receiptLine(line({ quantity: 3, quantityUnit: 'PIECE', totalPrice: 2.67 }))).toMatchObject({
      priceCents: 89,
      lineTotalCents: 267,
    });
    expect(
      receiptLine(line({ quantity: 2, quantityUnit: 'PIECE', unitPrice: 4.29, totalPrice: 7.58 })).warnings,
    ).toContain('PRICE_MISMATCH');
    // Zaokrąglenie kasy (0,734 × 9,99 = 7,3327) mieści się w tolerancji
    expect(
      receiptLine(line({ quantity: 0.734, quantityUnit: 'kg', unitPrice: 9.99, totalPrice: 7.34 })).warnings,
    ).toEqual([]);
  });

  it('kwoty w groszach bez błędów zaokrągleń', () => {
    expect(toCents(4.29)).toBe(429);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(19.99)).toBe(1999);
  });
});

describe('data zakupu', () => {
  const today = new Date('2026-10-19T12:00:00Z');
  it('poprawna data zostaje, przyszła i niepoprawna - brak daty', () => {
    expect(purchaseDate('2026-10-18', today)).toBe('2026-10-18');
    expect(purchaseDate('2026-12-01', today)).toBeNull();
    expect(purchaseDate('2026-02-30', today)).toBeNull();
    expect(purchaseDate('18.10.2026', today)).toBeNull();
    expect(purchaseDate(null, today)).toBeNull();
  });
});
