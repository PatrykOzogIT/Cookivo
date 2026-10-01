import { formatShoppingAmount, groupByCategory } from './shopping-format';

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
