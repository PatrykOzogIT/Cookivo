/**
 * Krok 3 importu przepisów: odczyty AI → recipes.import.jsonl + stany w rejestrze + raporty (bez AI).
 *
 *   npx tsx prisma/recipes-import/build.ts [--target 1000] [--cap 0.15]
 *
 * --target  ile przepisów ma trafić do pliku importu (przepisy już w pliku zostają w nim zawsze)
 * --cap     najwyżej taki udział jednej kategorii (zupy, ciasta…) w docelowej liczbie
 *
 * Kolejność: przepisy z polskich Wikibooks, potem angielskie wg wyświetleń. Przepisy czekające
 * na składnik / tłumaczenie wracają same przy kolejnym build, gdy składnik pojawi się w bazie
 * (fetch.ts snapshot) albo tłumaczenie w cache (ai.ts translate).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeSearch } from '../../src/common/text.js';
import { UNITS } from '../seed/reference-data.js';
import {
  TO_TRANSLATE,
  inputHash,
  readStructureCache,
  readTranslateCache,
  type TranslateInput,
} from './ai.js';
import {
  candidatePriority,
  evaluate,
  ingredientIndex,
  jaccard,
  sourceTexts,
  toRecord,
  type Candidate,
  type CatalogIngredient,
  type Evaluated,
} from './lib/build.js';
import {
  DIR,
  IMPORT_FILE,
  INGREDIENTS_SNAPSHOT,
  PHOTO_CACHE,
  RECIPES_SNAPSHOT,
  ensureOut,
  readCatalog,
  readJson,
  readJsonl,
  writeCatalog,
  writeJson,
  writeJsonl,
} from './lib/files.js';
import type { RecipePhoto, RecipeRecord } from './lib/record.js';
import type { RecipeState } from './lib/types.js';
import type { CommonsFile } from './lib/wiki.js';
import { rankImages } from './lib/wikitext.js';
import { csv } from '../import/lib/report.js';

export const REPORT_DIR = join(DIR, 'raport');

export interface PhotoCacheEntry {
  /** Licencja i plik w porządku */
  ok: boolean;
  reason?: string;
  info?: CommonsFile;
  /** Pobrane i przeliczone (jedno zdjęcie na stronę) */
  photo?: RecipePhoto;
}
export type PhotoCache = Record<string, PhotoCacheEntry>;

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

function main() {
  const target = arg('--target', Infinity);
  const cap = arg('--cap', 0.15);
  const catalog = readCatalog();
  const structure = readStructureCache();
  const translations = readTranslateCache();
  const photos = readJson<PhotoCache>(PHOTO_CACHE, {});
  const snapshot = readJson<(CatalogIngredient & { category: { code: string } })[]>(INGREDIENTS_SNAPSHOT, []);
  if (!snapshot.length) throw new Error('Brak listy składników - uruchom: fetch.ts snapshot');
  const ing = ingredientIndex(
    snapshot.map((i) => ({ ...i, category: i.category.code })),
    Object.fromEntries(UNITS.map((u) => [u.code, u.ml])),
  );
  const existingTitles = new Map(
    readJson<{ id: string; title: string }[]>(RECIPES_SNAPSHOT, []).map((r) => [
      normalizeSearch(r.title),
      r.id,
    ]),
  );
  /** Przepisy z poprzedniego pliku importu zostają w nim (mogą być już w bazie) */
  const previous = new Set(readJsonl<RecipeRecord>(IMPORT_FILE).map((r) => r.key));

  // 1. Kandydaci z odczytanych stron
  const evaluated: Evaluated[] = [];
  const pageStates = new Map<string, RecipeState[]>();
  for (const entry of catalog.values()) {
    const s = structure.items[entry.key];
    if (!s) {
      // Odczyt z innej wersji polecenia (cache wyczyszczony) - strona wraca do kolejki
      if (entry.status === 'PROCESSED' || entry.reason === 'NOT_A_RECIPE') {
        entry.status = 'NEW';
        delete entry.reason;
        delete entry.recipes;
      }
      continue;
    }
    entry.status = 'PROCESSED';
    delete entry.reason;
    if (!s.output.isRecipe || !s.output.recipes.length) {
      entry.status = 'REJECTED';
      entry.reason = 'NOT_A_RECIPE';
      delete entry.recipes;
      continue;
    }
    pageStates.set(entry.key, []);
    s.output.recipes.forEach((recipe, index) => {
      const c: Candidate = {
        key: `${entry.key}#${index + 1}`,
        pageKey: entry.key,
        wiki: entry.wiki,
        pageTitle: entry.title,
        revId: s.revId,
        views: entry.views,
        index,
        recipe,
        checks: s.checks[index] ?? [],
        images: s.images,
      };
      evaluated.push(evaluate(c, ing));
    });
  }

  // 2. Duble: ten sam rodzaj dania i prawie ten sam zestaw składników (też między językami)
  const ok = evaluated
    .filter((e) => e.status !== 'REJECTED')
    .sort((a, b) => candidatePriority(a.c, b.c, previous));
  const kept: { e: Evaluated; set: Set<string> }[] = [];
  for (const e of ok) {
    const set = new Set(e.lines.map((l) => l.ingredient));
    const dup = kept.find(
      (k) => k.e.c.recipe.course === e.c.recipe.course && set.size >= 4 && jaccard(k.set, set) >= 0.85,
    );
    if (dup) {
      e.status = 'DUPLICATE';
      e.reason = `${dup.e.c.key}`;
      continue;
    }
    kept.push({ e, set });
  }

  // 3. Wybór: limit liczby i kategorii; potem tłumaczenie i dubel po polskim tytule
  const perCourse = new Map<string, number>();
  const courseLimit = Number.isFinite(target) ? Math.ceil(target * cap) : Infinity;
  const toTranslate: Record<string, TranslateInput> = {};
  const records: RecipeRecord[] = [];
  const titles = new Map<string, string>();
  for (const { e } of kept) {
    if (e.status !== 'READY') continue;
    const sticky = previous.has(e.c.key);
    const course = e.c.recipe.course;
    if (
      !sticky &&
      (records.length + Object.keys(toTranslate).length >= target ||
        (perCourse.get(course) ?? 0) >= courseLimit)
    ) {
      e.status = 'OVER_LIMIT';
      continue;
    }
    const src = sourceTexts(e.recipe);
    const input: TranslateInput = { from: e.c.wiki, to: e.c.wiki === 'pl' ? 'en' : 'pl', ...src };
    const cached = translations.items[e.c.key];
    if (!cached || cached.hash !== inputHash(input)) {
      toTranslate[e.c.key] = input;
      e.status = 'WAITING_TRANSLATION';
      perCourse.set(course, (perCourse.get(course) ?? 0) + 1);
      continue;
    }
    const tr = cached.output;
    const [pl, en] = e.c.wiki === 'pl' ? [src, tr] : [tr, src];
    const titleKey = normalizeSearch(pl.title);
    const sameTitle =
      titles.get(titleKey) ??
      (existingTitles.has(titleKey) ? `cookivo:${existingTitles.get(titleKey)}` : null);
    if (sameTitle) {
      e.status = 'DUPLICATE';
      e.reason = sameTitle;
      continue;
    }
    titles.set(titleKey, e.c.key);
    // Zdjęcie strony tylko przy pierwszym przepisie ze strony
    const file =
      e.c.index === 0 ? rankImages(e.c.images, e.c.pageTitle).find((f) => photos[f]?.photo) : undefined;
    records.push(toRecord(e, pl, en, file ? photos[file].photo! : null));
    perCourse.set(course, (perCourse.get(course) ?? 0) + 1);
  }

  // 4. Stany w rejestrze
  for (const e of evaluated) {
    pageStates.get(e.c.pageKey)!.push({
      key: e.c.key,
      title: e.c.recipe.title,
      status: e.status,
      ...(e.status === 'DUPLICATE' ? { duplicateOf: e.reason } : e.reason ? { reason: e.reason } : {}),
      ...(e.missing ? { missing: e.missing } : {}),
    });
  }
  for (const [key, states] of pageStates) catalog.get(key)!.recipes = states;
  writeCatalog(catalog);
  records.sort((a, b) => a.key.localeCompare(b.key));
  writeJsonl(IMPORT_FILE, records);
  ensureOut();
  writeJson(TO_TRANSLATE, toTranslate);

  // 5. Raporty
  mkdirSync(REPORT_DIR, { recursive: true });
  const count = (list: string[]) =>
    [...list.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort(
      (a, b) => b[1] - a[1],
    );
  const byStatus = Object.fromEntries(count(evaluated.map((e) => e.status)));
  const ready = records;
  const summary = {
    pages: Object.fromEntries(count([...catalog.values()].map((c) => c.status))),
    recipes: byStatus,
    ready: ready.length,
    readyByWiki: Object.fromEntries(count(ready.map((r) => r.wiki))),
    readyByCourse: Object.fromEntries(count(ready.map((r) => r.course))),
    readyWithPhoto: ready.filter((r) => r.photo).length,
    toTranslate: Object.keys(toTranslate).length,
  };
  writeFileSync(join(REPORT_DIR, 'podsumowanie.json'), JSON.stringify(summary, null, 2) + '\n');
  const waiting = (status: string) =>
    count(evaluated.filter((e) => e.status === status).flatMap((e) => e.missing ?? []));
  writeFileSync(
    join(REPORT_DIR, 'brakujace-skladniki.csv'),
    csv(['skladnik', 'liczba_przepisow'], waiting('WAITING_INGREDIENT')),
  );
  writeFileSync(
    join(REPORT_DIR, 'brakujace-jednostki.csv'),
    csv(['skladnik_i_jednostka', 'liczba_przepisow'], waiting('WAITING_UNIT')),
  );
  writeFileSync(
    join(REPORT_DIR, 'odrzucone.csv'),
    csv(
      ['klucz', 'tytul', 'powod'],
      evaluated
        .filter((e) => e.status === 'REJECTED')
        .map((e) => [e.c.key, e.c.recipe.title, e.reason ?? '']),
    ),
  );
  writeFileSync(
    join(REPORT_DIR, 'duble.csv'),
    csv(
      ['klucz', 'tytul', 'dubel_przepisu'],
      evaluated
        .filter((e) => e.status === 'DUPLICATE')
        .map((e) => [e.c.key, e.c.recipe.title, e.reason ?? '']),
    ),
  );
  writeFileSync(
    join(REPORT_DIR, 'bez-zdjec.csv'),
    csv(
      ['klucz', 'tytul', 'powod'],
      ready
        .filter((r) => !r.photo)
        .map((r) => {
          const s = structure.items[r.key.split('#')[0]];
          const files = s?.images ?? [];
          const reason = !r.key.endsWith('#1')
            ? 'kolejny przepis ze strony'
            : !files.length
              ? 'brak zdjęcia na stronie'
              : !rankImages(files, r.source.sourceTitle).length
                ? 'na stronie tylko obrazy / mapy / ikony, nie zdjęcie potrawy'
                : files.map((f) => photos[f]?.reason ?? 'nie sprawdzono (photos.ts meta)').join(' | ');
          return [r.key, r.title, reason];
        }),
    ),
  );
  writeFileSync(
    join(REPORT_DIR, 'atrybucje.csv'),
    csv(
      ['klucz', 'tytul', 'zrodlo', 'historia', 'licencja', 'zdjecie', 'autor_zdjecia', 'licencja_zdjecia'],
      ready.map((r) => [
        r.key,
        r.title,
        r.source.url,
        r.source.historyUrl,
        r.source.license,
        r.photo?.sourceUrl ?? '',
        r.photo?.author ?? '',
        r.photo?.license ?? '',
      ]),
    ),
  );
  console.log(summary);
  console.log(`Plik importu: ${IMPORT_FILE} (${records.length}); raporty: ${REPORT_DIR}`);
  if (summary.toTranslate) console.log('Do tłumaczenia: ai.ts translate submit');
}

main();
