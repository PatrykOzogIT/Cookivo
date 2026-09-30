/**
 * Orientacyjne dzienne zapotrzebowanie energetyczne dzieci i młodzieży (kcal) wg wartości
 * referencyjnych EFSA (2013): 1-3 lata PAL ~1,4, 4-17 lat umiarkowana aktywność (PAL 1,6).
 * To punkt wyjścia do podziału porcji w rodzinie, nie zalecenie żywieniowe.
 */
const CHILD_KCAL: Record<number, { MALE: number; FEMALE: number }> = {
  1: { MALE: 765, FEMALE: 717 },
  2: { MALE: 1028, FEMALE: 956 },
  3: { MALE: 1171, FEMALE: 1100 },
  4: { MALE: 1291, FEMALE: 1195 },
  5: { MALE: 1362, FEMALE: 1267 },
  6: { MALE: 1458, FEMALE: 1338 },
  7: { MALE: 1554, FEMALE: 1434 },
  8: { MALE: 1649, FEMALE: 1530 },
  9: { MALE: 1769, FEMALE: 1625 },
  10: { MALE: 1888, FEMALE: 1745 },
  11: { MALE: 2008, FEMALE: 1840 },
  12: { MALE: 2127, FEMALE: 1936 },
  13: { MALE: 2294, FEMALE: 2055 },
  14: { MALE: 2462, FEMALE: 2127 },
  15: { MALE: 2581, FEMALE: 2175 },
  16: { MALE: 2677, FEMALE: 2199 },
  17: { MALE: 2749, FEMALE: 2223 },
};

/** Dorośli bez profilu - typowe wartości referencyjne */
const ADULT_KCAL = { MALE: 2500, FEMALE: 2000 };
/** Domownik, który nie udostępnia celu - neutralna waga przy podziale */
export const DEFAULT_KCAL = 2000;

export const MIN_DEPENDENT_AGE = 1;
export const MAX_DEPENDENT_AGE = 110;

export function ageFromBirthYear(birthYear: number, today = new Date()): number {
  return today.getFullYear() - birthYear;
}

export function referenceKcal(age: number, sex: 'MALE' | 'FEMALE'): number {
  if (age < MIN_DEPENDENT_AGE) return CHILD_KCAL[1][sex];
  return age >= 18 ? ADULT_KCAL[sex] : CHILD_KCAL[age][sex];
}
