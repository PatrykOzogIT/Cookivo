/** Pliki importu przepisów: rejestr stron, cache AI i treści stron (te ostatnie poza repozytorium) */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogEntry, Wiki } from './types.js';
import type { PageContent } from './wiki.js';

export const DIR = join(import.meta.dirname, '..');
export const OUT = join(DIR, 'out');
/** Rejestr wszystkich stron źródła ze stanem (w repozytorium) */
export const CATALOG_FILE = join(DIR, 'catalog.jsonl');
/** Plik importowy: przepisy gotowe do zapisu w bazie (w repozytorium) */
export const IMPORT_FILE = join(DIR, 'recipes.import.jsonl');
export const STRUCTURE_CACHE = join(DIR, 'ai-structure-cache.json');
export const TRANSLATE_CACHE = join(DIR, 'ai-translate-cache.json');
export const PHOTO_CACHE = join(DIR, 'photo-cache.json');
/** Szacunki wag miar kuchennych składników (AI, sprawdzone zakresami) - importer zapisze je w bazie */
export const UNIT_ESTIMATES = join(DIR, 'unit-estimates.json');
/** Miary do oszacowania, z build.ts */
export const UNIT_REQUESTS = join(OUT, 'unit-requests.json');
/** Zatwierdzone składniki z produkcji (publiczne API) - do dopasowania nazw */
export const INGREDIENTS_SNAPSHOT = join(OUT, 'ingredients.json');
/** Tytuły publicznych przepisów z produkcji - do wykrywania dubli */
export const RECIPES_SNAPSHOT = join(OUT, 'recipes.json');

export function ensureOut(): void {
  mkdirSync(OUT, { recursive: true });
}

export function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

export function writeJsonl(file: string, rows: unknown[]): void {
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}

export function readJson<T>(file: string, fallback: T): T {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback;
}

export function writeJson(file: string, value: unknown): void {
  writeFileSync(file, JSON.stringify(value, null, 1) + '\n');
}

export function readCatalog(): Map<string, CatalogEntry> {
  return new Map(readJsonl<CatalogEntry>(CATALOG_FILE).map((e) => [e.key, e]));
}

export function writeCatalog(catalog: Map<string, CatalogEntry>): void {
  const rows = [...catalog.values()].sort((a, b) =>
    a.wiki === b.wiki ? a.pageId - b.pageId : a.wiki.localeCompare(b.wiki),
  );
  writeJsonl(CATALOG_FILE, rows);
}

const pagesFile = (wiki: Wiki) => join(OUT, `pages-${wiki}.jsonl`);

export function readPages(wiki: Wiki): Map<number, PageContent> {
  return new Map(readJsonl<PageContent>(pagesFile(wiki)).map((p) => [p.pageId, p]));
}

export function writePages(wiki: Wiki, pages: PageContent[]): void {
  ensureOut();
  writeJsonl(pagesFile(wiki), pages);
}
