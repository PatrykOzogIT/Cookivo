import { expandRecipe, shoppingAmount, type RecipeForShopping } from './shopping-math.js';

describe('rozwijanie przepisu do składników', () => {
  const recipes = new Map<string, RecipeForShopping>([
    // Rosół: 1000 g (marchew 300 g, kurczak 700 g)
    [
      'rosol',
      {
        totalGrams: 1000,
        lines: [
          { ingredientId: 'marchew', subRecipeId: null, grams: 300 },
          { ingredientId: 'kurczak', subRecipeId: null, grams: 700 },
        ],
      },
    ],
    // Zupa: 500 g rosołu + 200 g marchwi
    [
      'zupa',
      {
        totalGrams: 700,
        lines: [
          { ingredientId: null, subRecipeId: 'rosol', grams: 500 },
          { ingredientId: 'marchew', subRecipeId: null, grams: 200 },
        ],
      },
    ],
  ]);

  it('sumuje składniki z podprzepisu proporcjonalnie do użytej ilości', () => {
    const acc = expandRecipe('zupa', 1, recipes);
    expect(acc.get('marchew')).toBeCloseTo(350); // 200 + 300 × 0,5
    expect(acc.get('kurczak')).toBeCloseTo(350);
  });

  it('skaluje przez liczbę partii i dodaje do istniejących sum', () => {
    const acc = expandRecipe('rosol', 2, recipes, new Map([['marchew', 100]]));
    expect(acc.get('marchew')).toBeCloseTo(700);
    expect(acc.get('kurczak')).toBeCloseTo(1400);
  });

  it('cykl nie zawiesza liczenia', () => {
    const cyclic = new Map<string, RecipeForShopping>([
      ['a', { totalGrams: 100, lines: [{ ingredientId: null, subRecipeId: 'a', grams: 100 }] }],
    ]);
    expect(expandRecipe('a', 1, cyclic).size).toBe(0);
  });
});

describe('ilości na liście zakupów', () => {
  const plain = { pieceGrams: null, density: null, liquid: false };

  it('sztuki w górę (z małą tolerancją)', () => {
    expect(shoppingAmount(420, { ...plain, pieceGrams: 150 })).toEqual({
      amount: 3,
      unit: 'PIECE',
      grams: 420,
    });
    expect(shoppingAmount(305, { ...plain, pieceGrams: 150 })).toMatchObject({ amount: 2 }); // 2,03 → 2
    expect(shoppingAmount(20, { ...plain, pieceGrams: 150 })).toMatchObject({ amount: 1 });
  });

  it('płyny w ml / l', () => {
    expect(shoppingAmount(515, { pieceGrams: null, density: 1.03, liquid: true })).toMatchObject({
      amount: 500,
      unit: 'ml',
    });
    expect(shoppingAmount(1340, { pieceGrams: null, density: 1.03, liquid: true })).toMatchObject({
      amount: 1.3,
      unit: 'l',
    });
  });

  it('gramy i kilogramy zaokrąglone w górę', () => {
    expect(shoppingAmount(73, plain)).toMatchObject({ amount: 75, unit: 'g' });
    expect(shoppingAmount(431, plain)).toMatchObject({ amount: 440, unit: 'g' });
    expect(shoppingAmount(1210, plain)).toMatchObject({ amount: 1.25, unit: 'kg' });
  });
});
