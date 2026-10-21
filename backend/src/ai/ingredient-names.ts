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
