import { duePurchases, toPlannerMeals } from './assistant-math.js';

const day = (n: number) => new Date(Date.UTC(2026, 9, 21) - n * 24 * 60 * 60 * 1000);

describe('co kupujesz regularnie, a się kończy', () => {
  it('mleko co ~5 dni, ostatnio 6 dni temu - do kupienia, w typowej ilości', () => {
    const due = duePurchases(
      [
        { ingredientId: 'mleko', on: day(16), grams: 2060 },
        { ingredientId: 'mleko', on: day(11), grams: 2060 },
        { ingredientId: 'mleko', on: day(6), grams: 1030 },
        { ingredientId: 'mleko', on: day(6), grams: 1030 },
      ],
      day(0),
    );
    expect(due).toEqual([{ ingredientId: 'mleko', everyDays: 5, lastDaysAgo: 6, grams: 2060 }]);
  });

  it('jeden zakup, świeży zakup i dawno porzucony produkt - bez podpowiedzi', () => {
    expect(
      duePurchases(
        [
          { ingredientId: 'raz', on: day(10), grams: 100 },
          { ingredientId: 'swiezy', on: day(9), grams: 100 },
          { ingredientId: 'swiezy', on: day(2), grams: 100 },
          { ingredientId: 'porzucony', on: day(60), grams: 100 },
          { ingredientId: 'porzucony', on: day(55), grams: 100 },
        ],
        day(0),
      ),
    ).toEqual([]);
  });
});

describe('plan → posiłki planera', () => {
  const dates = ['2026-10-22', '2026-10-23', '2026-10-24'];
  const order = ['BREAKFAST', 'DINNER', 'SUPPER'];

  it('resztki jedzą z wcześniejszego gotowania - partia rośnie', () => {
    const meals = toPlannerMeals(
      [
        { day: 2, slot: 'DINNER', recipeId: 'gulasz', leftover: true },
        { day: 1, slot: 'DINNER', recipeId: 'gulasz', leftover: false },
        { day: 1, slot: 'BREAKFAST', recipeId: 'owsianka', leftover: false },
      ],
      dates,
      2,
      order,
    );
    expect(meals).toEqual([
      { date: '2026-10-22', slot: 'BREAKFAST', recipeId: 'owsianka', servings: 2 },
      { date: '2026-10-22', slot: 'DINNER', recipeId: 'gulasz', servings: 2, cookServings: 4 },
      { date: '2026-10-23', slot: 'DINNER', recipeId: 'gulasz', servings: 2, fromIndex: 1 },
    ]);
  });

  it('resztki bez wcześniejszego gotowania stają się gotowaniem', () => {
    expect(
      toPlannerMeals([{ day: 3, slot: 'SUPPER', recipeId: 'nalesniki', leftover: true }], dates, 1, order),
    ).toEqual([{ date: '2026-10-24', slot: 'SUPPER', recipeId: 'nalesniki', servings: 1 }]);
  });
});
