/**
 * Szacunki wag miar kuchennych dla przepisów czekających na miarę (łyżka, łyżeczka, szklanka, szczypta,
 * sztuka) - to samo polecenie i te same zakresy co w aplikacji (`src/unit-estimates`), przez Batch API.
 *
 *   npx tsx prisma/recipes-import/units.ts submit   - miary z out/unit-requests.json (z build.ts)
 *   npx tsx prisma/recipes-import/units.ts fetch    - wyniki → unit-estimates.json; potem build.ts
 *
 * Importer zapisuje użyte szacunki w bazie jako `AI` (na karcie składnika: "szacunek").
 */
import 'dotenv/config';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { join } from 'node:path';
import { normalizeSearch } from '../../src/common/text.js';
import { checkEstimate } from '../../src/ingredients/kitchen-units.js';
import {
  UNIT_ESTIMATE_SYSTEM,
  UnitEstimateSchema,
  toUnitEstimate,
  unitEstimatePrompt,
} from '../../src/unit-estimates/unit-estimator.js';
import { fetchBatch, submitBatch, usageCost, type BatchRequest } from './lib/batch.js';
import type { UnitEstimates } from './lib/build.js';
import {
  INGREDIENTS_SNAPSHOT,
  OUT,
  UNIT_ESTIMATES,
  UNIT_REQUESTS,
  readJson,
  writeJson,
} from './lib/files.js';

const MODEL = process.env.RECIPES_STRUCTURE_MODEL ?? 'claude-haiku-5-5';
const STATE = join(OUT, 'units-batch.json');

async function submit() {
  const requests = readJson<Record<string, string[]>>(UNIT_REQUESTS, {});
  const done = readJson<UnitEstimates>(UNIT_ESTIMATES, {});
  const snapshot = readJson<{ namePl: string; nameEn: string | null; category: { code: string } }[]>(
    INGREDIENTS_SNAPSHOT,
    [],
  );
  const byName = new Map(snapshot.map((i) => [normalizeSearch(i.namePl), i]));
  // Składnik pytamy raz - o wszystkie miary naraz (jak w aplikacji)
  const todo = Object.keys(requests).filter(
    (name) => !done[normalizeSearch(name)] && byName.has(normalizeSearch(name)),
  );
  if (!todo.length) return console.log('Brak miar do oszacowania (uruchom build.ts).');
  const meta: Record<string, string> = {};
  const batch: BatchRequest[] = todo.map((name, i) => {
    const ing = byName.get(normalizeSearch(name))!;
    meta[`u${i}`] = normalizeSearch(name);
    return {
      customId: `u${i}`,
      params: {
        model: MODEL,
        max_tokens: 1000,
        system: UNIT_ESTIMATE_SYSTEM,
        output_config: { effort: 'low', format: zodOutputFormat(UnitEstimateSchema) },
        messages: [
          {
            role: 'user',
            content: unitEstimatePrompt({
              namePl: ing.namePl,
              nameEn: ing.nameEn,
              category: ing.category.code,
            }),
          },
        ],
      } as BatchRequest['params'],
    };
  });
  const id = await submitBatch(STATE, batch, meta);
  console.log(`Wysłano zadanie ${id}: ${batch.length} składników (${MODEL}).`);
}

async function fetchResults() {
  const res = await fetchBatch<Record<string, string>>(STATE);
  if (res === 'none') return console.log('Brak wysłanego zadania.');
  if (!res) return;
  const out = readJson<UnitEstimates>(UNIT_ESTIMATES, {});
  let ok = 0;
  for (const [customId, text] of res.results) {
    const parsed = text ? UnitEstimateSchema.safeParse(JSON.parse(text)) : null;
    if (!parsed?.success) continue;
    // Te same zakresy i proporcje co przy szacunku w aplikacji
    out[res.state[customId]] = checkEstimate(toUnitEstimate(parsed.data));
    ok++;
  }
  writeJson(UNIT_ESTIMATES, out);
  console.log(
    `Oszacowane składniki: ${ok}, nieudane: ${res.results.size - ok}. ≈ ${usageCost(MODEL, res.usage).toFixed(3)} USD. Teraz: build.ts`,
  );
}

const [cmd] = process.argv.slice(2);
if (cmd === 'submit') await submit();
else if (cmd === 'fetch') await fetchResults();
else console.error('Użycie: units.ts submit | fetch');
