import { ageOn, bmr, calculateTargets, type CalculatorInput } from './nutrition-calculator';

// Te same przypadki są w testach backendu - kalkulator istnieje w dwóch kopiach.
const woman: CalculatorInput = {
  sex: 'FEMALE',
  age: 30,
  heightCm: 165,
  weightKg: 60,
  activity: 'MODERATE',
  goal: 'MAINTAIN',
};

describe('kalkulator zapotrzebowania', () => {
  it('BMR wg Mifflina-St Jeora', () => {
    expect(bmr('FEMALE', 30, 165, 60)).toBeCloseTo(1320.25);
    expect(bmr('MALE', 30, 180, 80)).toBeCloseTo(1780);
  });

  it('utrzymanie: TDEE × aktywność, makro 1,6 g/kg białka i 30% tłuszczu', () => {
    const t = calculateTargets(woman);
    expect(t.bmr).toBe(1320);
    expect(t.tdee).toBe(2050); // 1320,25 × 1,55 = 2046
    expect(t.kcal).toBe(2050);
    expect(t.protein).toBe(96); // 1,6 × 60
    expect(t.fat).toBe(68); // 30% z 2050 / 9
    expect(t.carbs).toBe(264); // (2050 - 384 - 612) / 4 = 263,5
    expect(t.clampedToMinimum).toBe(false);
    expect(t.custom).toBe(false);
  });

  it('redukcja -20% i więcej białka; masa +10%', () => {
    expect(calculateTargets({ ...woman, goal: 'CUT' }).kcal).toBe(1640);
    expect(calculateTargets({ ...woman, goal: 'CUT' }).protein).toBe(132);
    expect(calculateTargets({ ...woman, goal: 'CUT_MILD' }).kcal).toBe(1840);
    expect(calculateTargets({ ...woman, goal: 'BULK' }).kcal).toBe(2250);
  });

  it('nie schodzi poniżej dolnego limitu bezpieczeństwa i to zaznacza', () => {
    const t = calculateTargets({
      sex: 'FEMALE',
      age: 70,
      heightCm: 150,
      weightKg: 45,
      activity: 'SEDENTARY',
      goal: 'CUT',
    });
    expect(t.kcal).toBe(1200);
    expect(t.clampedToMinimum).toBe(true);
  });

  it('ręczne nadpisania mają pierwszeństwo, reszta liczona od nich', () => {
    const t = calculateTargets({ ...woman, customKcal: 1800, customProtein: 120 });
    expect(t.kcal).toBe(1800);
    expect(t.protein).toBe(120);
    expect(t.fat).toBe(60);
    expect(t.carbs).toBe(195); // (1800 - 480 - 540) / 4
    expect(t.custom).toBe(true);
  });

  it('liczy wiek z daty urodzenia (przed i po urodzinach)', () => {
    const today = new Date(2026, 8, 30);
    expect(ageOn(new Date(1996, 8, 30), today)).toBe(30);
    expect(ageOn(new Date(1996, 9, 1), today)).toBe(29);
  });
});
