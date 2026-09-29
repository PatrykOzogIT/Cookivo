/**
 * Prosty filtr wulgaryzmów PL/EN. Normalizuje tekst (diakrytyki, leetspeak,
 * powtórzenia liter) i sprawdza go dwiema listami:
 *  - SUBSTRING_ROOTS: rdzenie jednoznaczne, szukane w dowolnym miejscu tekstu,
 *  - WHOLE_WORDS: słowa, które bywają fragmentem niewinnych wyrazów
 *    (np. "shiitake", "grapefruit", "cocktail"), więc dopasowujemy je tylko jako całe słowa.
 * W etapie moderacji listy trafią do bazy, żeby admin mógł je edytować.
 */
const SUBSTRING_ROOTS = [
  'kurw',
  'chuj',
  'pierdol',
  'jeban',
  'jebac',
  'jebie',
  'pizd',
  'skurw',
  'spierdal',
  'zajeb',
  'kutas',
  'fuck',
  'cunt',
  'whore',
  'bitch',
];

const WHOLE_WORDS = [
  'huj',
  'cipa',
  'dziwka',
  'szmata',
  'pedal',
  'ciota',
  'debil',
  'fiut',
  'dupek',
  'shit',
  'dick',
  'cock',
  'nigger',
  'nigga',
  'pussy',
  'slut',
  'fag',
  'rape',
  'retard',
  'nazi',
  'hitler',
];

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '!': 'i',
  '|': 'i',
  '3': 'e',
  '4': 'a',
  '@': 'a',
  '5': 's',
  $: 's',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '+': 't',
};

export function normalizeForModeration(text: string): string {
  return text
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[0-9!|@$+]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1+/g, '$1');
}

const ROOTS_N = SUBSTRING_ROOTS.map(normalizeForModeration);
const WORDS_N = new Set(WHOLE_WORDS.map(normalizeForModeration));

export function containsProfanity(text: string): boolean {
  if (ROOTS_N.some((root) => normalizeForModeration(text).includes(root))) return true;
  return text
    .split(/[\s._\-,;:/\\()"']+/)
    .map(normalizeForModeration)
    .some((word) => WORDS_N.has(word));
}
