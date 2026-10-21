import type { AuthUser } from '../common/auth.decorators.js';
import { normalizeSearch } from '../common/text.js';
import { isConfidentMatch } from './ingredient-names.js';
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

export { isConfidentMatch, unitAllowed } from './ingredient-names.js';
