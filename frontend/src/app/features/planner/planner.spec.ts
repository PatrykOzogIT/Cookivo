import { addDays, balanceStatus, dayTotals, mondayOf, weekDays, weekFromParam } from './plan-math';
import type { PlanMeal } from './planner.api';

describe('daty planera', () => {
  it('poniedziałek tygodnia (także przez przełom miesiąca i dla niedzieli)', () => {
    expect(mondayOf('2026-10-07')).toBe('2026-10-05'); // środa
    expect(mondayOf('2026-10-05')).toBe('2026-10-05');
    expect(mondayOf('2026-10-11')).toBe('2026-10-05'); // niedziela
    expect(mondayOf('2026-11-01')).toBe('2026-10-26');
  });

  it('dodawanie dni przez zmianę czasu i rok', () => {
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26'); // zmiana czasu 25.10
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(weekDays('2026-12-28')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
  });

  it('parametr tygodnia: poprawny, dowolny dzień, śmieci', () => {
    expect(weekFromParam('2026-10-08', '2026-01-01')).toBe('2026-10-05');
    expect(weekFromParam('2026-02-30', '2026-10-08')).toBe('2026-10-05');
    expect(weekFromParam(undefined, '2026-10-08')).toBe('2026-10-05');
  });
});

describe('bilans dnia', () => {
  const meal = (kcal: number, myServings: number) =>
    ({ myServings, recipe: { perServing: { kcal, protein: 10, fat: 5, carbs: 20 } } }) as PlanMeal;

  it('sumuje moje porcje', () => {
    expect(dayTotals([meal(400, 1), meal(300, 0.5)])).toEqual({
      kcal: 550,
      protein: 15,
      fat: 7.5,
      carbs: 30,
    });
  });

  it('ocena względem celu ±10%', () => {
    expect(balanceStatus(0, 2000)).toBe('empty');
    expect(balanceStatus(1700, 2000)).toBe('under');
    expect(balanceStatus(1900, 2000)).toBe('ok');
    expect(balanceStatus(2200, 2000)).toBe('ok');
    expect(balanceStatus(2300, 2000)).toBe('over');
    expect(balanceStatus(1500, undefined)).toBe('empty');
  });
});

describe('bilans osoby w trybie dokładnym', () => {
  const meal = (shares: { key: string; servings: number }[]) =>
    ({
      myServings: 99,
      shares: shares.map((s) => ({ ...s, fraction: 0, grams: null, kcal: 0 })),
      recipe: { perServing: { kcal: 400, protein: 20, fat: 10, carbs: 50 } },
    }) as unknown as PlanMeal;

  it('liczy porcję wskazanej osoby, a nieobecna nic nie je', () => {
    const meals = [
      meal([
        { key: 'u:ja', servings: 1.2 },
        { key: 'd:ola', servings: 0.8 },
      ]),
      meal([{ key: 'u:ja', servings: 1 }]),
    ];
    expect(dayTotals(meals, 'd:ola')).toEqual({ kcal: 320, protein: 16, fat: 8, carbs: 40 });
    expect(dayTotals(meals, 'u:ja').kcal).toBeCloseTo(880);
  });
});
