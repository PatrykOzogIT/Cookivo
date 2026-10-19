import {
  defaultShoppingUnit,
  formatShoppingAmount,
  groupByCategory,
  shoppingUnitOptions,
} from './shopping-format';

describe('ilości na liście zakupów', () => {
  it('sztuki z gramami, kg i ml z polskim przecinkiem', () => {
    expect(formatShoppingAmount({ amount: 3, unit: 'PIECE', grams: 450 }, 'pl', 'szt.', 'ok.')).toBe(
      '3 szt. (ok. 450 g)',
    );
    expect(formatShoppingAmount({ amount: 1.25, unit: 'kg', grams: 1210 }, 'pl', 'szt.', 'ok.')).toBe(
      '1,25 kg',
    );
    expect(formatShoppingAmount({ amount: 1.3, unit: 'l', grams: 1340 }, 'en', 'pcs', 'approx.')).toBe(
      '1.3 l',
    );
  });
});

describe('grupowanie działami sklepu', () => {
  const item = (code: string | null, sortOrder = 0) => ({
    ingredient: code ? { category: { code, sortOrder } } : null,
  });

  it('kolejność kategorii, własne pozycje na końcu', () => {
    const groups = groupByCategory([item('DAIRY', 8), item(null), item('VEGETABLES', 1), item('DAIRY', 8)]);
    expect(groups.map((g) => [g.code, g.items.length])).toEqual([
      ['VEGETABLES', 1],
      ['DAIRY', 2],
      ['CUSTOM', 1],
    ]);
  });
});

describe('ilość wpisana ręcznie', () => {
  const label = (code: string, n: number) => `${n} ${code === 'CAN' ? 'puszki' : code}`;

  it('zostaje w swojej jednostce: sztuki bez gramów, kg, puszki z odmianą', () => {
    expect(
      formatShoppingAmount(
        { amount: 5, unit: 'PIECE', grams: 600, manual: true },
        'pl',
        'szt.',
        'ok.',
        label,
      ),
    ).toBe('5 szt.');
    expect(
      formatShoppingAmount(
        { amount: 2.5, unit: 'kg', grams: 2500, manual: true },
        'pl',
        'szt.',
        'ok.',
        label,
      ),
    ).toBe('2,5 kg');
    expect(
      formatShoppingAmount({ amount: 2, unit: 'CAN', grams: 800, manual: true }, 'pl', 'szt.', 'ok.', label),
    ).toBe('2 puszki');
  });

  it('jednostki: kg po g, l po ml (tylko z gęstością); domyślnie sztuki albo kg', () => {
    const rice = { kind: 'ingredient' as const, id: 'r', name: { namePl: 'Ryż', nameEn: 'Rice' } };
    expect(shoppingUnitOptions(rice, []).map((u) => u.code)).toEqual(['g', 'kg']);
    const milk = { ...rice, density: 1.03 };
    expect(shoppingUnitOptions(milk, []).map((u) => u.code)).toEqual(['g', 'kg', 'ml', 'l']);
    expect(defaultShoppingUnit(rice)).toBe('kg');
    const banana = { ...rice, units: [{ code: 'PIECE', grams: 120, namePl: 'sztuka', nameEn: 'piece' }] };
    expect(defaultShoppingUnit(banana)).toBe('PIECE');
  });
});
