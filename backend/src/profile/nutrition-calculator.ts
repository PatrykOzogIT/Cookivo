/**
 * Kalkulator zapotrzebowania - czysta funkcja.
 * UWAGA: identyczna kopia jest we frontendzie (frontend/src/app/features/profile/nutrition-calculator.ts),
 * żeby gość widział wynik od razu. Zmieniać razem (testy po obu stronach mają te same przypadki).
 *
 * 1. Podstawowa przemiana materii (BMR) - wzór Mifflina-St Jeora (1990).
 * 2. Całkowite zapotrzebowanie (TDEE) = BMR × współczynnik aktywności.
 * 3. Cel: redukcja -20% / łagodna -10% / utrzymanie / masa +10%.
 * 4. Dolny limit bezpieczeństwa: 1200 kcal (kobiety) / 1500 kcal (mężczyźni).
 * 5. Makro: białko wg celu (g/kg masy), tłuszcz 30% energii, reszta węglowodany.
 */

export type Sex = 'FEMALE' | 'MALE';
export type Activity = 'SEDENTARY' | 'LIGHT' | 'MODERATE' | 'ACTIVE' | 'VERY_ACTIVE';
export type Goal = 'CUT' | 'CUT_MILD' | 'MAINTAIN' | 'BULK';

export const ACTIVITY_FACTORS: Record<Activity, number> = {
  SEDENTARY: 1.2,
  LIGHT: 1.375,
  MODERATE: 1.55,
  ACTIVE: 1.725,
  VERY_ACTIVE: 1.9,
};

export const GOAL_ADJUSTMENT: Record<Goal, number> = { CUT: -0.2, CUT_MILD: -0.1, MAINTAIN: 0, BULK: 0.1 };

/** Białko w g na kg masy ciała - więcej przy redukcji, żeby chronić mięśnie */
export const PROTEIN_PER_KG: Record<Goal, number> = { CUT: 2.2, CUT_MILD: 2.0, MAINTAIN: 1.6, BULK: 1.8 };

export const MIN_KCAL: Record<Sex, number> = { FEMALE: 1200, MALE: 1500 };
export const FAT_SHARE = 0.3;
export const MIN_AGE = 18;
export const MAX_AGE = 100;

export interface CalculatorInput {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: Activity;
  goal: Goal;
  customKcal?: number | null;
  customProtein?: number | null;
  customFat?: number | null;
  customCarbs?: number | null;
}

export interface Targets {
  bmr: number;
  tdee: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  /** Cel obcięty do dolnego limitu bezpieczeństwa */
  clampedToMinimum: boolean;
  /** Któraś wartość pochodzi z ręcznego nadpisania */
  custom: boolean;
}

export function ageOn(birthDate: Date, today = new Date()): number {
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
  return age;
}

export function bmr(sex: Sex, age: number, heightCm: number, weightKg: number): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'MALE' ? 5 : -161);
}

const round10 = (v: number) => Math.round(v / 10) * 10;

export function calculateTargets(input: CalculatorInput): Targets {
  const base = bmr(input.sex, input.age, input.heightCm, input.weightKg);
  const tdee = base * ACTIVITY_FACTORS[input.activity];
  const goalKcal = tdee * (1 + GOAL_ADJUSTMENT[input.goal]);
  const minimum = MIN_KCAL[input.sex];
  const autoKcal = Math.max(goalKcal, minimum);

  const kcal = input.customKcal ?? round10(autoKcal);
  const protein = input.customProtein ?? Math.round(PROTEIN_PER_KG[input.goal] * input.weightKg);
  const fat = input.customFat ?? Math.round((kcal * FAT_SHARE) / 9);
  const carbs = input.customCarbs ?? Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));

  return {
    bmr: Math.round(base),
    tdee: round10(tdee),
    kcal,
    protein,
    fat,
    carbs,
    clampedToMinimum: input.customKcal == null && goalKcal < minimum,
    custom: [input.customKcal, input.customProtein, input.customFat, input.customCarbs].some(
      (v) => v != null,
    ),
  };
}
