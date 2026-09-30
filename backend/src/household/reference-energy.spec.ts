import { ageFromBirthYear, referenceKcal } from './reference-energy.js';

describe('wartości referencyjne energii', () => {
  it('rosną z wiekiem, chłopcy więcej niż dziewczęta', () => {
    expect(referenceKcal(3, 'FEMALE')).toBe(1100);
    expect(referenceKcal(8, 'MALE')).toBe(1649);
    for (let age = 2; age <= 17; age++) {
      expect(referenceKcal(age, 'MALE')).toBeGreaterThan(referenceKcal(age - 1, 'MALE'));
      expect(referenceKcal(age, 'MALE')).toBeGreaterThanOrEqual(referenceKcal(age, 'FEMALE'));
    }
  });

  it('dorośli bez profilu i skrajne wartości', () => {
    expect(referenceKcal(18, 'FEMALE')).toBe(2000);
    expect(referenceKcal(45, 'MALE')).toBe(2500);
    expect(referenceKcal(0, 'MALE')).toBe(765);
  });

  it('wiek z roku urodzenia', () => {
    expect(ageFromBirthYear(2018, new Date('2026-09-30'))).toBe(8);
  });
});
