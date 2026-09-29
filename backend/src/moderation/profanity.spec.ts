import { containsProfanity, normalizeForModeration } from './profanity.js';

describe('normalizeForModeration', () => {
  it('usuwa diakrytyki, leetspeak, separatory i powtórzenia', () => {
    expect(normalizeForModeration('Żółć')).toBe('zolc');
    expect(normalizeForModeration('K.u.r.w.a')).toBe('kurwa');
    expect(normalizeForModeration('kuuurwaaa')).toBe('kurwa');
    expect(normalizeForModeration('$h1t')).toBe('shit');
  });
});

describe('containsProfanity', () => {
  it.each(['Ty kurwo', 'k u r w a', 'F*U*C*K', 'spierdalaj', 'what a shit recipe'])(
    'wykrywa "%s"',
    (text) => {
      expect(containsProfanity(text)).toBe(true);
    },
  );

  // Kuchnia jest pełna słów, które zawierają krótkie wulgaryzmy - nie mogą być blokowane.
  it.each([
    'Zupa z grzybami shiitake',
    'Sałatka z grapefruitem',
    'Cocktail z mango',
    'Dickensowski pudding',
    'Nigella damascena (czarnuszka)',
    'Hubert poleca',
  ])('nie oznacza niewinnego tekstu "%s"', (text) => {
    expect(containsProfanity(text)).toBe(false);
  });
});
