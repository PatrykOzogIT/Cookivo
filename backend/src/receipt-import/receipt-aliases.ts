import { normalizeSearch } from '../common/text.js';

/**
 * Powiązania "tekst z paragonu → składnik" - czysta logika: klucze po normalizacji
 * i wybór domyślnego powiązania z głosów wszystkich użytkowników.
 */

/** Od tylu głosów i takiej przewagi domyślne powiązanie dopasowuje się samo */
export const CONFIDENT_VOTES = 3;
export const CONFIDENT_SHARE = 0.7;

/** Sieć sklepu: pierwsze słowo nazwy ("Biedronka" → "biedronka", "Lidl sp. z o.o." → "lidl"); "" = brak */
export function storeKey(store: string | null | undefined): string {
  const words = normalizeSearch(store ?? '')
    .split(' ')
    .filter((w) => w.length >= 2);
  return (words[0] ?? '').slice(0, 40);
}

/**
 * Nazwa produktu z paragonu bez wielkości liter, polskich znaków, spacji i interpunkcji -
 * drobne różnice odczytu ("MlekoŚw3,2 1l" / "Mleko Sw 3,2 1L") dają ten sam klucz.
 */
export function textKey(text: string | null | undefined): string {
  return normalizeSearch(text ?? '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 120);
}

export interface VoteCount {
  ingredientId: string;
  votes: number;
}

export interface DefaultAlias {
  ingredientId: string;
  votes: number;
  total: number;
  /** Dość głosów i przewagi - dopasowujemy bez pytania */
  confident: boolean;
}

/** Domyślne powiązanie = składnik z największą liczbą głosów (remis: brak domyślnego) */
export function pickDefault(counts: VoteCount[]): DefaultAlias | null {
  const merged = new Map<string, number>();
  for (const c of counts) merged.set(c.ingredientId, (merged.get(c.ingredientId) ?? 0) + c.votes);
  const sorted = [...merged.entries()].sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return null;
  const [[ingredientId, votes], second] = sorted;
  if (second && second[1] === votes) return null;
  const total = sorted.reduce((sum, [, v]) => sum + v, 0);
  return {
    ingredientId,
    votes,
    total,
    confident: votes >= CONFIDENT_VOTES && votes / total >= CONFIDENT_SHARE,
  };
}
