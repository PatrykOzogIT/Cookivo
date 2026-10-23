/**
 * Krok 2 i 4 importu przepisów - AI przez Batch API (połowa ceny), wyniki w cache w repozytorium:
 *
 *   npx tsx prisma/recipes-import/ai.ts structure submit --pl N --en M   - odczyt stron (Haiku): kolejne
 *                                       nieprzetworzone strony (PL i EN wg wyświetleń)
 *   npx tsx prisma/recipes-import/ai.ts structure fetch
 *   npx tsx prisma/recipes-import/ai.ts translate submit                 - tłumaczenia (Sonnet) przepisów
 *                                       wskazanych przez build (out/to-translate.json)
 *   npx tsx prisma/recipes-import/ai.ts translate fetch
 *
 * Wymaga ANTHROPIC_API_KEY w backend/.env. Cache: strona + wersja (revId) + wersja polecenia -
 * ponowne uruchomienie nie płaci drugi raz.
 */
import 'dotenv/config';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  PageSchema,
  STRUCTURE_PROMPT_VERSION,
  TRANSLATE_PROMPT_VERSION,
  TranslationSchema,
  structureSystem,
  translateSystem,
  type PageOutput,
  type TranslationOutput,
} from './lib/ai-schema.js';
import { fetchBatch, submitBatch, usageCost, type BatchRequest } from './lib/batch.js';
import {
  INGREDIENTS_SNAPSHOT,
  OUT,
  STRUCTURE_CACHE,
  TRANSLATE_CACHE,
  readCatalog,
  readJson,
  readPages,
  writeJson,
} from './lib/files.js';
import { type Wiki } from './lib/types.js';
import { amountInText, overlap, wordSet } from './lib/units.js';
import { cleanWikitext } from './lib/wikitext.js';

export const STRUCTURE_MODEL = process.env.RECIPES_STRUCTURE_MODEL ?? 'claude-haiku-5-5';
export const TRANSLATE_MODEL = process.env.RECIPES_TRANSLATE_MODEL ?? 'claude-sonnet-5-5';
const STRUCTURE_STATE = join(OUT, 'structure-batch.json');
const TRANSLATE_STATE = join(OUT, 'translate-batch.json');
export const TO_TRANSLATE = join(OUT, 'to-translate.json');

export interface StructureEntry {
  revId: number;
  model: string;
  images: string[];
  categories: string[];
  output: PageOutput;
  /** Wyniki kontroli z tekstem strony, dla każdego przepisu: kody z numerem pozycji */
  checks: string[][];
}
export interface StructureCache {
  version: number;
  items: Record<string, StructureEntry>;
  /** Strony, których odczyt się nie udał (np. za długa odpowiedź) - ponownie przy kolejnym submit */
  failed?: Record<string, number>;
}

export function readStructureCache(): StructureCache {
  const c = readJson<StructureCache>(STRUCTURE_CACHE, { version: STRUCTURE_PROMPT_VERSION, items: {} });
  return c.version === STRUCTURE_PROMPT_VERSION ? c : { version: STRUCTURE_PROMPT_VERSION, items: {} };
}

export interface TranslateInput {
  from: 'pl' | 'en';
  to: 'pl' | 'en';
  title: string;
  description: string | null;
  groups: string[];
  notes: string[];
  steps: string[];
}
export interface TranslateCache {
  version: number;
  items: Record<string, { hash: string; model: string; output: TranslationOutput }>;
}

export function readTranslateCache(): TranslateCache {
  const c = readJson<TranslateCache>(TRANSLATE_CACHE, { version: TRANSLATE_PROMPT_VERSION, items: {} });
  return c.version === TRANSLATE_PROMPT_VERSION ? c : { version: TRANSLATE_PROMPT_VERSION, items: {} };
}

export const inputHash = (i: TranslateInput) => createHash('sha1').update(JSON.stringify(i)).digest('hex');

function catalogNames(): string[] {
  const list = readJson<{ namePl: string }[]>(INGREDIENTS_SNAPSHOT, []);
  if (!list.length) throw new Error('Brak listy składników - uruchom: fetch.ts snapshot');
  return list.map((i) => i.namePl).sort((a, b) => a.localeCompare(b, 'pl'));
}

/** Kontrola odczytu z tekstem strony: ilości i linie składników, kroki ze strony */
export function textChecks(output: PageOutput, source: string): string[][] {
  const words = wordSet(source);
  return output.recipes.map((r) => {
    const flags: string[] = [];
    r.ingredients.forEach((l, i) => {
      if (l.amount !== null && !amountInText(l.amount, l.text)) flags.push(`AMOUNT_NOT_IN_SOURCE:${i}`);
      if (overlap(l.text, words) < 0.6) flags.push(`LINE_NOT_IN_SOURCE:${i}`);
    });
    r.steps.forEach((s, i) => {
      if (overlap(s.text, words) < 0.5) flags.push(`STEP_NOT_IN_SOURCE:${i}`);
    });
    return flags;
  });
}

async function structureSubmit(pl: number, en: number) {
  const catalog = readCatalog();
  const cache = readStructureCache();
  // Strona, której odczyt nie udał się dwa razy, nie wraca (raport: cache.failed)
  const fresh = [...catalog.values()].filter(
    (e) => e.status === 'NEW' && !cache.items[e.key] && (cache.failed?.[e.key] ?? 0) < 2,
  );
  const byViews = (wiki: Wiki) =>
    fresh.filter((e) => e.wiki === wiki).sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
  const chosen = [...byViews('pl').slice(0, pl), ...byViews('en').slice(0, en)];
  if (!chosen.length) return console.log('Brak nieprzetworzonych stron.');
  const pages = { pl: readPages('pl'), en: readPages('en') };
  const system = structureSystem(catalogNames());
  const meta: Record<string, { key: string; revId: number; images: string[]; categories: string[] }> = {};
  const requests: BatchRequest[] = chosen.map((e, i) => {
    const page = pages[e.wiki].get(e.pageId);
    if (!page) throw new Error(`Brak treści strony ${e.key} - uruchom: fetch.ts pages`);
    const clean = cleanWikitext(page.text);
    meta[`p${i}`] = { key: e.key, revId: page.revId, images: clean.images, categories: clean.categories };
    return {
      customId: `p${i}`,
      params: {
        model: STRUCTURE_MODEL,
        max_tokens: 12000,
        // Długa lista składników jest wspólna dla wszystkich zapytań - cache
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        output_config: { effort: 'low', format: zodOutputFormat(PageSchema) },
        messages: [
          {
            role: 'user',
            content: `Strona: ${page.title} (Wikibooks ${e.wiki.toUpperCase()}, język strony: ${e.wiki === 'pl' ? 'polski' : 'angielski'})\nKategorie: ${clean.categories.join(', ') || '-'}\n\n${clean.text}`,
          },
        ],
      } as BatchRequest['params'],
    };
  });
  const id = await submitBatch(STRUCTURE_STATE, requests, meta);
  console.log(`Wysłano zadanie ${id}: ${requests.length} stron (${STRUCTURE_MODEL}).`);
}

async function structureFetch() {
  const res =
    await fetchBatch<Record<string, { key: string; revId: number; images: string[]; categories: string[] }>>(
      STRUCTURE_STATE,
    );
  if (res === 'none') return console.log('Brak wysłanego zadania.');
  if (!res) return;
  const cache = readStructureCache();
  cache.failed ??= {};
  const pages = { pl: readPages('pl'), en: readPages('en') };
  let ok = 0;
  for (const [customId, text] of res.results) {
    const m = res.state[customId];
    const parsed = text ? PageSchema.safeParse(JSON.parse(text)) : null;
    if (!parsed?.success) {
      cache.failed[m.key] = (cache.failed[m.key] ?? 0) + 1;
      continue;
    }
    const [, wiki, pageId] = /^wikibooks-(pl|en):(\d+)$/.exec(m.key)!;
    const page = pages[wiki as Wiki].get(Number(pageId));
    cache.items[m.key] = {
      revId: m.revId,
      model: STRUCTURE_MODEL,
      images: m.images,
      categories: m.categories,
      output: parsed.data,
      checks: textChecks(parsed.data, page && page.revId === m.revId ? cleanWikitext(page.text).text : ''),
    };
    delete cache.failed[m.key];
    ok++;
  }
  writeJson(STRUCTURE_CACHE, cache);
  console.log(
    `Odczytane strony: ${ok}, nieudane: ${res.results.size - ok}. Tokeny: ${JSON.stringify(res.usage)} ≈ ${usageCost(
      STRUCTURE_MODEL,
      res.usage,
    ).toFixed(3)} USD. Teraz: build.ts`,
  );
}

/** Ponowna kontrola odczytów z tekstem stron (po zmianie reguł kontroli) - bez AI */
function structureRecheck() {
  const cache = readStructureCache();
  const pages = { pl: readPages('pl'), en: readPages('en') };
  let n = 0;
  for (const [key, item] of Object.entries(cache.items)) {
    const [, wiki, pageId] = /^wikibooks-(pl|en):(\d+)$/.exec(key)!;
    const page = pages[wiki as Wiki].get(Number(pageId));
    if (!page || page.revId !== item.revId) continue;
    item.checks = textChecks(item.output, cleanWikitext(page.text).text);
    n++;
  }
  writeJson(STRUCTURE_CACHE, cache);
  console.log(`Sprawdzone ponownie: ${n} stron.`);
}

async function translateSubmit() {
  const todo = readJson<Record<string, TranslateInput>>(TO_TRANSLATE, {});
  const cache = readTranslateCache();
  const keys = Object.keys(todo).filter((k) => cache.items[k]?.hash !== inputHash(todo[k]));
  if (!keys.length) return console.log('Nic do tłumaczenia (uruchom build.ts).');
  const meta: Record<string, { key: string; hash: string }> = {};
  const requests: BatchRequest[] = keys.map((key, i) => {
    const input = todo[key];
    meta[`t${i}`] = { key, hash: inputHash(input) };
    const { from, to, ...content } = input;
    return {
      customId: `t${i}`,
      params: {
        model: TRANSLATE_MODEL,
        max_tokens: 8000,
        system: translateSystem(from, to),
        output_config: { effort: 'low', format: zodOutputFormat(TranslationSchema) },
        messages: [{ role: 'user', content: JSON.stringify(content) }],
      } as BatchRequest['params'],
    };
  });
  const id = await submitBatch(TRANSLATE_STATE, requests, meta);
  console.log(`Wysłano zadanie ${id}: ${requests.length} przepisów (${TRANSLATE_MODEL}).`);
}

async function translateFetch() {
  const res = await fetchBatch<Record<string, { key: string; hash: string }>>(TRANSLATE_STATE);
  if (res === 'none') return console.log('Brak wysłanego zadania.');
  if (!res) return;
  const todo = readJson<Record<string, TranslateInput>>(TO_TRANSLATE, {});
  const cache = readTranslateCache();
  let ok = 0;
  for (const [customId, text] of res.results) {
    const m = res.state[customId];
    const parsed = text ? TranslationSchema.safeParse(JSON.parse(text)) : null;
    const input = todo[m.key];
    // Ta sama liczba elementów - inaczej tłumaczenie nie pasuje do przepisu
    if (
      !parsed?.success ||
      !input ||
      parsed.data.groups.length !== input.groups.length ||
      parsed.data.notes.length !== input.notes.length ||
      parsed.data.steps.length !== input.steps.length
    ) {
      continue;
    }
    cache.items[m.key] = { hash: m.hash, model: TRANSLATE_MODEL, output: parsed.data };
    ok++;
  }
  writeJson(TRANSLATE_CACHE, cache);
  console.log(
    `Przetłumaczone: ${ok}, nieudane: ${res.results.size - ok}. Tokeny: ${JSON.stringify(res.usage)} ≈ ${usageCost(
      TRANSLATE_MODEL,
      res.usage,
    ).toFixed(3)} USD. Teraz: build.ts`,
  );
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('recipes-import/ai.ts');
if (isMain) {
  const [stage, mode] = process.argv.slice(2);
  const arg = (name: string, fallback: number) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? Number(process.argv[i + 1]) : fallback;
  };
  if (stage === 'structure' && mode === 'submit') await structureSubmit(arg('--pl', 0), arg('--en', 0));
  else if (stage === 'structure' && mode === 'fetch') await structureFetch();
  else if (stage === 'structure' && mode === 'recheck') structureRecheck();
  else if (stage === 'translate' && mode === 'submit') await translateSubmit();
  else if (stage === 'translate' && mode === 'fetch') await translateFetch();
  else
    console.error(
      'Użycie: ai.ts structure submit --pl N --en M | structure fetch | translate submit | translate fetch',
    );
}
