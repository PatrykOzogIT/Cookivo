import type { AuthUser } from '../common/auth.decorators.js';
import { normalizeSearch } from '../common/text.js';
import { ListIngredientsQuery } from '../ingredients/ingredients.dto.js';
import type { IngredientsService } from '../ingredients/ingredients.service.js';

export type Candidate = Awaited<ReturnType<IngredientsService['list']>>['items'][number];

/**
 * Dopasowanie nazwy odczytanej przez AI do składnika z bazy (wyszukiwarka składników):
 * pewne dopasowanie albo do 3 podpowiedzi.
 */
export async function matchIngredient(
  ingredients: IngredientsService,
  name: string,
  user: AuthUser,
): Promise<{ match: Candidate | null; suggestions: Candidate[]; partial: Candidate | null }> {
  const q = name.trim();
  if (!q) return { match: null, suggestions: [], partial: null };
  const found = (await ingredients.list(Object.assign(new ListIngredientsQuery(), { q, pageSize: 4 }), user))
    .items;
  const best = found[0];
  if (best && isConfidentMatch(q, best)) return { match: best, suggestions: [], partial: null };
  // Nazwa z bazy jest początkiem odczytanej ("mąka pszenna typ 650" → "Mąka pszenna") - tylko do potwierdzenia
  const nq = normalizeSearch(q);
  const partial =
    found
      .filter((c) => {
        const n = normalizeSearch(c.namePl);
        return n.length >= 3 && nq.startsWith(`${n} `);
      })
      .sort((a, b) => b.namePl.length - a.namePl.length)[0] ?? null;
  return { match: null, suggestions: found.slice(0, 3), partial };
}

/**
 * Pewne dopasowanie: nazwa z bazy jest tą samą nazwą albo zaczyna się od niej
 * ("mleko" → "Mleko 3,2%", "mąka pszenna" → "Mąka pszenna"). Inaczej tylko podpowiedzi -
 * dlatego "mleko 2%" nigdy nie zostanie po cichu "Mlekiem 3,2%".
 */
export function isConfidentMatch(name: string, c: { namePl: string }): boolean {
  const q = normalizeSearch(name);
  const n = normalizeSearch(c.namePl);
  return !!q && (n === q || n.startsWith(`${q} `) || n.startsWith(`${q},`) || n.startsWith(`${q} (`));
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
