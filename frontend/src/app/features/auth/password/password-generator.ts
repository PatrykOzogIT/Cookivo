/**
 * Generator haseł oparty o crypto.getRandomValues (kryptograficznie bezpieczny).
 * Pomija znaki łatwe do pomylenia (l, I, 1, O, 0), gwarantuje każdą klasę znaków
 * i losuje bez obciążenia modulo (rejection sampling).
 */
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*-_=+?';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

export const GENERATED_PASSWORD_LENGTH = 20;

function randomIndex(max: number, rng: Crypto): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  let value: number;
  do {
    rng.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return value % max;
}

function pick(chars: string, rng: Crypto): string {
  return chars[randomIndex(chars.length, rng)];
}

export function generatePassword(length = GENERATED_PASSWORD_LENGTH, rng: Crypto = crypto): string {
  if (length < 4) throw new Error('Hasło musi mieć co najmniej 4 znaki');
  const chars = [pick(LOWER, rng), pick(UPPER, rng), pick(DIGITS, rng), pick(SYMBOLS, rng)];
  while (chars.length < length) chars.push(pick(ALL, rng));

  // Tasowanie Fishera-Yatesa, żeby wymagane klasy nie stały zawsze na początku
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1, rng);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
