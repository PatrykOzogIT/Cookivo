/**
 * Normalizacja tekstu do wyszukiwania: małe litery, bez polskich znaków,
 * pojedyncze spacje. "Żółty Ser" → "zolty ser".
 */
export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
}
