export type Wiki = 'pl' | 'en';

/**
 * Stan strony źródła w rejestrze (catalog.jsonl):
 * NEW - nieprzetworzona (kolejne uruchomienia biorą następne wg wyświetleń);
 * INCOMPLETE - odrzucona przez prostą kontrolę bez AI (brak listy składników, ilości albo kroków);
 * REJECTED - odczyt AI: to nie przepis (np. strona o składniku, przegląd odmian);
 * PROCESSED - odczytana, stan każdego przepisu ze strony w `recipes`.
 */
export type PageStatus = 'NEW' | 'INCOMPLETE' | 'REJECTED' | 'PROCESSED';

/**
 * Stan przepisu ze strony (jedna strona może mieć kilka przepisów: klucz …#2):
 * REJECTED - nie przeszedł kontroli jakości (powód); DUPLICATE - dubel (duplicateOf);
 * WAITING_INGREDIENT / WAITING_UNIT - czeka na składnik albo jego jednostkę / gęstość (missing);
 * WAITING_TRANSLATION - gotowy poza tłumaczeniem; READY - w pliku importu;
 * OVER_LIMIT - poprawny, ale nie zmieścił się w limicie (liczba / kategoria) - weźmie go kolejne uruchomienie.
 */
export type RecipeStatus =
  | 'REJECTED'
  | 'DUPLICATE'
  | 'WAITING_INGREDIENT'
  | 'WAITING_UNIT'
  | 'WAITING_TRANSLATION'
  | 'READY'
  | 'OVER_LIMIT';

export interface RecipeState {
  key: string;
  title: string;
  status: RecipeStatus;
  /** Kody powodów odrzucenia / oczekiwania */
  reason?: string;
  /** Brakujące składniki (nazwy PL) albo "nazwa (jednostka)" */
  missing?: string[];
  duplicateOf?: string;
}

/** Strona źródła w rejestrze - wszystkie strony z obu Wikibooks, także odrzucone */
export interface CatalogEntry {
  /** wikibooks-pl:<pageid> */
  key: string;
  wiki: Wiki;
  pageId: number;
  title: string;
  revId: number;
  /** Wyświetlenia w 12 miesięcy (null = nie sprawdzane - strona odpadła wcześniej) */
  views: number | null;
  status: PageStatus;
  reason?: string;
  recipes?: RecipeState[];
}

export const catalogKey = (wiki: Wiki, pageId: number) => `wikibooks-${wiki}:${pageId}`;

export function pageUrl(wiki: Wiki, title: string): string {
  return `https://${wiki}.wikibooks.org/wiki/${encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/')}`;
}

export function historyUrl(wiki: Wiki, title: string): string {
  return `https://${wiki}.wikibooks.org/w/index.php?title=${encodeURIComponent(title.replace(/ /g, '_'))}&action=history`;
}
