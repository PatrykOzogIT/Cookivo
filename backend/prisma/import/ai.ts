/**
 * Krok 2 importu składników: polskie nazwy, kategorie, propozycje alergenów i jednostek przez AI
 * - tylko dla kandydatów bez wpisu w cache. Wartości odżywczych model NIE podaje (są ze źródeł).
 *
 *   npx tsx prisma/import/ai.ts [--limit N] [--dry-run]
 *
 * Wymaga ANTHROPIC_API_KEY w backend/.env (lokalnie, nigdy w repozytorium).
 * Wyniki zapisuje do prisma/import/ai-cache.json po każdej paczce - przerwanie nie gubi pracy.
 */
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { INGREDIENT_CATALOG } from '../seed/ingredients.catalog.js';
import { CIQUAL_CATALOG } from '../seed/ingredients.ciqual.js';
import { AI_SYSTEM, AiBatchSchema, PROMPT_VERSION, type AiCache, type AiItem } from './lib/ai-schema.js';
import type { Candidate } from './lib/dedupe.js';

export const CACHE_FILE = join(import.meta.dirname, 'ai-cache.json');
const CANDIDATES = join(import.meta.dirname, 'out', 'candidates.jsonl');
const BATCH = 40;
const CONCURRENCY = 4;

export function readCandidates(file = CANDIDATES): Candidate[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Candidate);
}

export function readCache(model: string): AiCache {
  if (!existsSync(CACHE_FILE)) return { version: PROMPT_VERSION, model, items: {} };
  const cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as AiCache;
  // Inna wersja polecenia = cache nieaktualny (pytamy od nowa)
  return cache.version === PROMPT_VERSION ? cache : { version: PROMPT_VERSION, model, items: {} };
}

/** Nazwy obecnego katalogu - model wskazuje, gdy produkt już jest (dubel pod inną nazwą) */
export function catalogNames(): string[] {
  return [...INGREDIENT_CATALOG.map((i) => i.pl), ...CIQUAL_CATALOG.map((i) => i.pl)].sort((a, b) =>
    a.localeCompare(b, 'pl'),
  );
}

export function batchPrompt(batch: Candidate[]): string {
  return [
    'Produkty (kod | nazwa EN | nazwa FR | grupa w źródle):',
    ...batch.map((c, i) => `k${i + 1} | ${c.nameEn} | ${c.nameFr ?? '-'} | ${c.groupName}`),
  ].join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const limit = Number(args[args.indexOf('--limit') + 1]) || Infinity;
  const dryRun = args.includes('--dry-run');
  const model = process.env.IMPORT_AI_MODEL ?? process.env.RECIPE_IMPORT_MODEL ?? 'claude-haiku-5-5';
  const cache = readCache(model);
  const todo = readCandidates()
    .filter((c) => !cache.items[c.importKey])
    .slice(0, limit);
  const batches: Candidate[][] = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
  console.log(
    `Do opracowania: ${todo.length} kandydatów w ${batches.length} paczkach (cache: ${Object.keys(cache.items).length}).`,
  );
  if (dryRun || !batches.length) return;
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Brak ANTHROPIC_API_KEY w backend/.env');

  const client = new Anthropic({ maxRetries: 3, timeout: 120_000 });
  const catalog = `Składniki Cookivo:\n${catalogNames().join('\n')}`;
  let tokensIn = 0;
  let tokensOut = 0;
  let done = 0;
  let failed = 0;
  const save = () => writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1) + '\n');

  const worker = async () => {
    for (let batch = batches.shift(); batch; batch = batches.shift()) {
      let res;
      try {
        res = await client.messages.parse({
          model,
          max_tokens: 16000,
          // Stały prefiks (reguły + katalog) z cache - kolejne paczki płacą za niego ułamek
          system: [
            { type: 'text', text: AI_SYSTEM },
            { type: 'text', text: catalog, cache_control: { type: 'ephemeral' } },
          ],
          output_config: { effort: 'low', format: zodOutputFormat(AiBatchSchema) },
          messages: [{ role: 'user', content: batchPrompt(batch) }],
        });
      } catch (err) {
        // Paczka bez odpowiedzi zostaje poza cache - następne uruchomienie ją powtórzy
        failed += batch.length;
        console.warn(`Paczka nieudana (${batch.length}): ${(err as Error).message}`);
        continue;
      }
      tokensIn +=
        res.usage.input_tokens +
        (res.usage.cache_read_input_tokens ?? 0) +
        (res.usage.cache_creation_input_tokens ?? 0);
      tokensOut += res.usage.output_tokens;
      const items = res.parsed_output?.items ?? [];
      for (const item of items) {
        const index = Number(item.code.replace(/^k/, '')) - 1;
        const c = batch[index];
        if (!c) continue;
        const { code: _code, ...rest } = item as AiItem;
        cache.items[c.importKey] = rest;
      }
      done += batch.length;
      save();
      console.log(`${done}/${todo.length} (tokeny: ${tokensIn} wej., ${tokensOut} wyj.)`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  save();
  if (failed) console.warn(`Nieopracowane: ${failed} - uruchom ponownie, żeby dokończyć.`);
  console.log(`Gotowe. Tokeny łącznie: ${tokensIn} wejściowych, ${tokensOut} wyjściowych.`);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) await main();
