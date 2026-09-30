import { FormControl, NonNullableFormBuilder } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { adultValidator, buildCalculatorForm, targetsFromForm } from './calculator-form';
import { describeDevice } from './settings-page';

function isoYearsAgo(years: number, extraDays = 0): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setDate(d.getDate() + extraDays);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe('walidator wieku', () => {
  it('przepuszcza pełnoletnich i puste pole (obsługuje je required)', () => {
    expect(adultValidator(new FormControl(isoYearsAgo(30), { nonNullable: true }))).toBeNull();
    expect(adultValidator(new FormControl(isoYearsAgo(18), { nonNullable: true }))).toBeNull();
    expect(adultValidator(new FormControl('', { nonNullable: true }))).toBeNull();
  });

  it('odrzuca niepełnoletnich - nawet dzień przed 18. urodzinami', () => {
    expect(adultValidator(new FormControl(isoYearsAgo(18, 1), { nonNullable: true }))).toEqual({
      age: { min: 18, max: 100 },
    });
    expect(adultValidator(new FormControl(isoYearsAgo(101), { nonNullable: true }))).not.toBeNull();
  });
});

describe('formularz kalkulatora', () => {
  const form = () => buildCalculatorForm(TestBed.inject(NonNullableFormBuilder));

  it('liczy cel z polskim przecinkiem w wadze', () => {
    const f = form();
    f.patchValue({ birthDate: isoYearsAgo(35), heightCm: '170', weightKg: '65,5' });
    expect(f.valid).toBe(true);
    const t = targetsFromForm(f.getRawValue(), f.valid);
    expect(t?.kcal).toBeGreaterThan(1500);
    expect(t?.protein).toBeCloseTo(65.5 * 1.6, 0);
  });

  it('niekompletne dane = brak wyniku', () => {
    const f = form();
    f.patchValue({ heightCm: '170' });
    expect(targetsFromForm(f.getRawValue(), f.valid)).toBeNull();
  });

  it('własne kalorie zastępują wyliczenie', () => {
    const f = form();
    f.patchValue({ birthDate: isoYearsAgo(35), heightCm: '170', weightKg: '65', customKcal: '2000' });
    expect(targetsFromForm(f.getRawValue(), f.valid)?.kcal).toBe(2000);
  });
});

describe('opis urządzenia z User-Agenta', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      'Chrome · Windows',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Safari · iOS',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox · Linux'],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0',
      'Edge · Windows',
    ],
  ])('%s', (ua, expected) => {
    expect(describeDevice(ua)).toBe(expected);
  });

  it('nieznany klient = null (szablon pokazuje tłumaczenie)', () => {
    expect(describeDevice(null)).toBeNull();
    expect(describeDevice('node-superagent/3.8.3')).toBeNull();
  });
});
