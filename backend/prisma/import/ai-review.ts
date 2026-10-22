/**
 * Automatyczna recenzja rekordów PENDING drugim modelem (Sonnet) przez Batch API (połowa ceny).
 *
 *   npx tsx prisma/import/ai-review.ts submit [--limit N]   - wysyła paczki bez recenzji w cache
 *   npx tsx prisma/import/ai-review.ts fetch                - sprawdza wysłane zadanie, zapisuje wyniki
 *   npx tsx prisma/import/ai-review.ts apply                - decyzje → review-decisions.json + CSV z resztą
 *
 * Zasady łączenia (kod, nie model): bierzemy tylko APPROVE z pewnością HIGH; alergeny = suma
 * (pierwszy model ∪ recenzent ∪ reguła z nazwy); LOW → plik do ręcznego przejrzenia; REJECT → pomijamy.
 * Wymaga ANTHROPIC_API_KEY w backend/.env.
 */
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCandidates } from './ai.js';
import { DECISIONS_FILE, IMPORT_FILE, readDecisions } from './build.js';
import { allergensFromName } from './lib/allergens.js';
import { CATEGORY_CODES } from './lib/ai-schema.js';
import {
  REVIEW_PROMPT_VERSION,
  REVIEW_SYSTEM,
  ReviewBatchSchema,
  type ReviewItem,
} from './lib/ai-review-schema.js';
import type { ImportRecord } from './lib/record.js';
import { csv } from './lib/report.js';
import { exportReview, reasonText } from './lib/review.js';

const REVIEW_CACHE = join(import.meta.dirname, 'ai-review-cache.json');
const BATCH_STATE = join(import.meta.dirname, 'out', 'review-batch.json');
const BATCH = 40;
const MODEL = process.env.IMPORT_REVIEW_MODEL ?? 'claude-sonnet-5-5';

interface ReviewCache {
  version: number;
  model: string;
  items: Record<string, Omit<ReviewItem, 'code'>>;
}

function readReviewCache(): ReviewCache {
  if (!existsSync(REVIEW_CACHE)) return { version: REVIEW_PROMPT_VERSION, model: MODEL, items: {} };
  const c = JSON.parse(readFileSync(REVIEW_CACHE, 'utf8')) as ReviewCache;
  return c.version === REVIEW_PROMPT_VERSION
    ? c
    : { version: REVIEW_PROMPT_VERSION, model: MODEL, items: {} };
}

function readRecords(): ImportRecord[] {
  return readFileSync(IMPORT_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ImportRecord);
}

/** Rekordy do recenzji: PENDING, bez ręcznej decyzji i bez recenzji w cache */
function pending(records: ImportRecord[], cache: ReviewCache): ImportRecord[] {
  const decided = readDecisions();
  return records.filter((r) => r.status === 'PENDING' && !decided[r.importKey] && !cache.items[r.importKey]);
}

function prompt(batch: ImportRecord[], sourceNames: Map<string, string>): string {
  return [
    'Rekordy (kod | nazwa PL | nazwa EN | nazwa w źródle | kategoria | alergeny | waga sztuki g | kcal/B/T/W na 100 g | powody):',
    ...batch.map(
      (r, i) =>
        `k${i + 1} | ${r.namePl} | ${r.nameEn ?? '-'} | ${sourceNames.get(r.importKey) ?? '-'} | ${r.categoryCode} | ${
          r.allergens.join(',') || '-'
        } | ${r.units.find((u) => u.code === 'PIECE')?.grams ?? '-'} | ${r.kcal}/${r.protein}/${r.fat}/${r.carbs} | ${r.review
          .map(reasonText)
          .join('; ')}`,
    ),
  ].join('\n');
}

async function submit(limit: number) {
  if (existsSync(BATCH_STATE)) {
    throw new Error(`Jest już wysłane zadanie (${BATCH_STATE}) - najpierw "fetch".`);
  }
  const cache = readReviewCache();
  const todo = pending(readRecords(), cache).slice(0, limit);
  if (!todo.length) return console.log('Nic do recenzji.');
  const sourceNames = new Map(readCandidates().map((c) => [c.importKey, c.nameEn]));
  const chunks: ImportRecord[][] = [];
  for (let i = 0; i < todo.length; i += BATCH) chunks.push(todo.slice(i, i + BATCH));
  const client = new Anthropic();
  const batch = await client.messages.batches.create({
    requests: chunks.map((chunk, i) => ({
      custom_id: `r${i}`,
      params: {
        model: MODEL,
        max_tokens: 16000,
        system: REVIEW_SYSTEM,
        output_config: { effort: 'low', format: zodOutputFormat(ReviewBatchSchema) },
        messages: [{ role: 'user', content: prompt(chunk, sourceNames) }],
      },
    })),
  });
  mkdirSync(join(import.meta.dirname, 'out'), { recursive: true });
  writeFileSync(
    BATCH_STATE,
    JSON.stringify({ id: batch.id, chunks: chunks.map((c) => c.map((r) => r.importKey)) }, null, 1),
  );
  console.log(
    `Wysłano zadanie ${batch.id}: ${todo.length} rekordów w ${chunks.length} zapytaniach (${MODEL}).`,
  );
}

async function fetchResults() {
  if (!existsSync(BATCH_STATE)) return console.log('Brak wysłanego zadania.');
  const state = JSON.parse(readFileSync(BATCH_STATE, 'utf8')) as { id: string; chunks: string[][] };
  const client = new Anthropic();
  const batch = await client.messages.batches.retrieve(state.id);
  if (batch.processing_status !== 'ended') {
    const c = batch.request_counts;
    return console.log(`W toku: ${c.processing} w trakcie, ${c.succeeded} gotowe, ${c.errored} błędy.`);
  }
  const cache = readReviewCache();
  let tokensIn = 0;
  let tokensOut = 0;
  let failed = 0;
  for await (const result of await client.messages.batches.results(state.id)) {
    const keys = state.chunks[Number(result.custom_id.slice(1))];
    if (result.result.type !== 'succeeded') {
      failed += keys.length;
      continue;
    }
    const msg = result.result.message;
    tokensIn += msg.usage.input_tokens;
    tokensOut += msg.usage.output_tokens;
    const text = msg.content.find((b) => b.type === 'text');
    const parsed = text ? ReviewBatchSchema.safeParse(JSON.parse(text.text)) : null;
    if (!parsed?.success) {
      failed += keys.length;
      continue;
    }
    for (const item of parsed.data.items) {
      const key = keys[Number(item.code.replace(/^k/, '')) - 1];
      if (!key) continue;
      const { code: _code, ...rest } = item;
      cache.items[key] = rest;
    }
  }
  writeFileSync(REVIEW_CACHE, JSON.stringify(cache, null, 1) + '\n');
  // Zadanie rozliczone - kolejne "submit" może wysłać brakujące (np. nieudane)
  renameSync(BATCH_STATE, `${BATCH_STATE}.${state.id}.done`);
  // Batch API: połowa ceny standardowej (Sonnet 5.5: 2 / 10 USD za mln tokenów)
  const usd = (tokensIn * 1 + tokensOut * 5) / 1_000_000;
  console.log(
    `Wyniki zapisane. Tokeny: ${tokensIn} wej., ${tokensOut} wyj. (≈ ${usd.toFixed(2)} USD). Nieudane rekordy: ${failed}.`,
  );
}

function apply() {
  const records = readRecords();
  const cache = readReviewCache();
  const decisions = readDecisions();
  const leftovers: ImportRecord[] = [];
  const rejected: (string | number)[][] = [];
  let approved = 0;
  for (const r of records) {
    const rev = cache.items[r.importKey];
    if (r.status !== 'PENDING' || decisions[r.importKey] || !rev) continue;
    if (rev.decision === 'REJECT') {
      rejected.push([r.importKey, r.namePl, rev.reason]);
      continue;
    }
    if (rev.confidence !== 'HIGH') {
      leftovers.push(r);
      continue;
    }
    const category = (CATEGORY_CODES as readonly string[]).includes(rev.category)
      ? rev.category
      : r.categoryCode;
    // Alergeny: suma propozycji obu modeli i reguły z nazwy - nadmiarowy alergen jest bezpieczniejszy niż brak
    const allergens = [
      ...new Set([...r.allergens, ...rev.allergens, ...allergensFromName(`${r.nameEn ?? ''}`)]),
    ].sort();
    decisions[r.importKey] = {
      namePl: rev.namePl.trim() || r.namePl,
      nameEn: rev.nameEn.trim() || r.nameEn,
      categoryCode: category,
      allergens,
      pieceGrams: rev.pieceGrams && rev.pieceGrams > 0 && rev.pieceGrams <= 5000 ? rev.pieceGrams : null,
      allergensTypical: true,
    };
    approved++;
  }
  writeFileSync(DECISIONS_FILE, JSON.stringify(decisions, null, 1) + '\n');
  const dir = join(import.meta.dirname, 'review');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'do-weryfikacji-reszta.csv'), exportReview(leftovers));
  writeFileSync(join(dir, 'odrzucone-przez-recenzenta.csv'), csv(['klucz', 'nazwa_pl', 'powod'], rejected));
  console.log(
    `Zatwierdzone automatycznie: ${approved}; odrzucone: ${rejected.length}; do ręcznego przejrzenia: ${leftovers.length}. Teraz: npm run ingredients:build`,
  );
}

const [mode] = process.argv.slice(2);
const limitArg = process.argv.indexOf('--limit');
const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;
if (mode === 'rereview-state') {
  // Ponowna recenzja odrzuceń z powodu stanu obróbki (poprawiona reguła w poleceniu)
  const cache = readReviewCache();
  const re = /(obr[óo]bk|gotowan|pieczon|pieczenie|sma[żz]on|dusz|grillow|sposób przygotowania|stan |surow)/i;
  const keys = Object.entries(cache.items)
    .filter(([, v]) => v.decision === 'REJECT' && re.test(v.reason))
    .map(([k]) => k);
  for (const k of keys) delete cache.items[k];
  writeFileSync(REVIEW_CACHE, JSON.stringify(cache, null, 1) + '\n');
  console.log(`Do ponownej recenzji: ${keys.length}`);
  await submit(Infinity);
} else if (mode === 'submit') await submit(limit);
else if (mode === 'fetch') await fetchResults();
else if (mode === 'apply') apply();
else console.error('Użycie: ai-review.ts submit [--limit N] | fetch | apply');
