/** Porównywanie nazw z AI ze składnikami z bazy - czysta logika (testy jednostkowe bez Nest) */
import { normalizeSearch } from '../common/text.js';

/**
 * Pewne dopasowanie: nazwa z bazy jest tą samą nazwą albo zaczyna się od niej
 * ("mleko" → "Mleko 3,2%", "mąka pszenna" → "Mąka pszenna"). Inaczej tylko podpowiedzi -
 * dlatego "mleko 2%" nigdy nie zostanie po cichu "Mlekiem 3,2%".
 */
export function isConfidentMatch(name: string, c: { namePl: string }): boolean {
  const q = normalizeSearch(name);
  const n = normalizeSearch(c.namePl);
  if (!q) return false;
  if (n === q || n.startsWith(`${q} `) || n.startsWith(`${q},`) || n.startsWith(`${q} (`)) return true;
  // Liczba mnoga w bazie ("ziemniak" → "Ziemniaki", "pomidor" → "Pomidory"): 1-2 litery końcówki
  const rest = n.slice(q.length);
  return q.length >= 4 && n.startsWith(q) && rest.length <= 2 && /^[a-z]+$/.test(rest);
}

/** Te same reguły co gramsFor / formularz: g zawsze, ml i miary kuchenne przy gęstości, własne jednostki */
export function unitAllowed(
  unit: string,
  c: { density: number | null; units: { code: string }[] },
  unitMl: Record<string, number | null>,
): boolean {
  if (unit === 'g' || unit === 'kg') return true;
  if (c.units.some((u) => u.code === unit)) return true;
  if (unit === 'ml' || unit === 'l') return !!c.density;
  return !!unitMl[unit] && !!c.density;
}

/**
 * Czy nowy składnik może być dublem istniejącego (ostrzeżenie w formularzu): ta sama nazwa
 * PL lub EN po normalizacji, liczba mnoga albo jedna nazwa jest początkiem drugiej
 * ("Mąka pszenna typ 650" ↔ "Mąka pszenna").
 */
export function similarName(name: string, c: { namePl: string; nameEn: string | null }): boolean {
  const q = normalizeSearch(name);
  if (q.length < 3) return false;
  return [c.namePl, c.nameEn ?? ''].some((raw) => {
    const n = normalizeSearch(raw);
    if (n.length < 3) return false;
    if (n === q || n.startsWith(`${q} `) || q.startsWith(`${n} `)) return true;
    const [short, long] = n.length < q.length ? [n, q] : [q, n];
    const rest = long.slice(short.length);
    return short.length >= 4 && long.startsWith(short) && rest.length <= 2 && /^[a-z]+$/.test(rest);
  });
}
