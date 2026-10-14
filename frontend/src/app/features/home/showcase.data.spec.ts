import { INITIAL_SLIDE, SLIDES, stepIndex } from './showcase.data';

describe('prezentacja funkcji', () => {
  it('klucze są unikalne', () => {
    expect(new Set(SLIDES.map((s) => s.key)).size).toBe(SLIDES.length);
  });

  it('kolejność: najpierw funkcje bez konta, opcjonalne dodatki na końcu', () => {
    const firstAccount = SLIDES.findIndex((s) => s.access === 'account');
    expect(SLIDES.slice(firstAccount).every((s) => s.access === 'account')).toBe(true);
    const firstOptional = SLIDES.findIndex((s) => s.optional);
    expect(SLIDES.slice(firstOptional).every((s) => s.optional)).toBe(true);
  });

  it('slajd startowy istnieje', () => {
    expect(SLIDES.some((s) => s.key === INITIAL_SLIDE)).toBe(true);
  });

  it('ścieżki są wewnętrzne', () => {
    for (const s of SLIDES) expect(s.path.startsWith('/')).toBe(true);
  });

  it('stepIndex zawija w obie strony', () => {
    expect(stepIndex(0, -1, 8)).toBe(7);
    expect(stepIndex(7, 1, 8)).toBe(0);
    expect(stepIndex(3, 2, 8)).toBe(5);
    expect(stepIndex(9, 0, 8)).toBe(1);
  });
});
