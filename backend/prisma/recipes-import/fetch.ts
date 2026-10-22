/**
 * Krok 1 importu przepisów: strony Wikibooks → rejestr (catalog.jsonl), bez AI.
 *
 *   npx tsx prisma/recipes-import/fetch.ts pages      - lista stron obu Wikibooks + treść + prosta kontrola
 *   npx tsx prisma/recipes-import/fetch.ts views      - wyświetlenia (12 mies.) dla kompletnych stron
 *   npx tsx prisma/recipes-import/fetch.ts snapshot   - zatwierdzone składniki i tytuły przepisów z produkcji
 *
 * Treści stron trafiają do out/ (poza repozytorium); rejestr zapamiętuje stan każdej strony,
 * żeby kolejne uruchomienia brały tylko nieprzetworzone i nie dublowały przepisów.
 */
import {
  CATALOG_FILE,
  INGREDIENTS_SNAPSHOT,
  RECIPES_SNAPSHOT,
  ensureOut,
  readCatalog,
  readPages,
  writeCatalog,
  writeJson,
  writePages,
} from './lib/files.js';
import { catalogKey, type Wiki } from './lib/types.js';
import { fetchContents, listPages, pageViews } from './lib/wiki.js';
import { judge } from './lib/wikitext.js';

const PROD = process.env.COOKIVO_URL ?? 'https://cookivo.pl';

async function pages() {
  const catalog = readCatalog();
  for (const wiki of ['pl', 'en'] as Wiki[]) {
    const list = await listPages(wiki);
    console.log(`${wiki}: ${list.length} stron, pobieram treść…`);
    const contents = await fetchContents(
      wiki,
      list.map((p) => p.pageId),
    );
    writePages(wiki, contents);
    const counts: Record<string, number> = {};
    for (const p of contents) {
      const key = catalogKey(wiki, p.pageId);
      const old = catalog.get(key);
      // Przetworzone strony zostają przy swojej wersji (atrybucja i cache AI są do niej przypięte)
      if (old && old.status !== 'NEW' && old.status !== 'INCOMPLETE') continue;
      const verdict = judge(p.text);
      catalog.set(key, {
        key,
        wiki,
        pageId: p.pageId,
        title: p.title,
        revId: p.revId,
        views: old?.views ?? null,
        status: verdict === 'OK' ? 'NEW' : 'INCOMPLETE',
        ...(verdict === 'OK' ? {} : { reason: verdict }),
      });
      counts[verdict] = (counts[verdict] ?? 0) + 1;
    }
    console.log(`${wiki}:`, counts);
  }
  writeCatalog(catalog);
  console.log(`Rejestr: ${CATALOG_FILE}`);
}

async function views() {
  const catalog = readCatalog();
  const todo = [...catalog.values()].filter((e) => e.status === 'NEW' && e.views === null);
  console.log(`Wyświetlenia dla ${todo.length} stron…`);
  let done = 0;
  // Dwa zapytania naraz z przerwą - API pageviews szybko odpowiada 429
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      for (let e = queue.shift(); e; e = queue.shift()) {
        e.views = await pageViews(e.wiki, e.title);
        await new Promise((r) => setTimeout(r, 150));
        if (++done % 200 === 0) {
          console.log(`  ${done}/${todo.length}`);
          writeCatalog(catalog);
        }
      }
    }),
  );
  writeCatalog(catalog);
  console.log('Gotowe.');
}

async function getAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${PROD}${path}${path.includes('?') ? '&' : '?'}page=${page}&pageSize=50`);
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    const j = (await res.json()) as { items: T[]; total: number };
    out.push(...j.items);
    if (out.length >= j.total || !j.items.length) return out;
  }
}

async function snapshot() {
  ensureOut();
  const ingredients = await getAll<Record<string, unknown>>('/api/ingredients?status=APPROVED');
  writeJson(INGREDIENTS_SNAPSHOT, ingredients);
  const recipes = await getAll<{ id: string; title: string }>('/api/recipes?sort=newest&forMe=0');
  writeJson(
    RECIPES_SNAPSHOT,
    recipes.map((r) => ({ id: r.id, title: r.title })),
  );
  console.log(`Składniki: ${ingredients.length}, przepisy publiczne: ${recipes.length} (${PROD}).`);
}

const [cmd] = process.argv.slice(2);
if (cmd === 'pages') await pages();
else if (cmd === 'views') await views();
else if (cmd === 'snapshot') await snapshot();
else {
  console.error('Użycie: fetch.ts pages | views | snapshot');
  // Pages są potrzebne do kolejnych kroków - podpowiedź, jeśli ich brak
  if (!readPages('pl').size) console.error('Zacznij od: fetch.ts pages');
}
