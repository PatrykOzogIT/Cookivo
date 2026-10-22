/**
 * Krok 1 importu składników: źródła → selekcja → deduplikacja → kandydaci (bez AI, bez bazy).
 *
 *   npx tsx prisma/import/etl.ts <katalog-ciqual-xml> <katalog-usda-csv>
 *
 * Zapisuje prisma/import/out/candidates.jsonl i raport selekcji (odrzucone, scalone).
 * Pozycje, które już są w katalogu Cookivo (ten sam kod Ciqual / FDC), są pomijane.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import usdaCatalogData from '../seed/ingredients.data.json' with { type: 'json' };
import { CIQUAL_CATALOG } from '../seed/ingredients.ciqual.js';
import { dedupe, type Candidate } from './lib/dedupe.js';
import { csv } from './lib/report.js';
import { selectFood } from './lib/select.js';
import { readCiqual, readUsda } from './lib/sources.js';
import type { RejectReason, SourceFood } from './lib/types.js';

export const OUT_DIR = join(import.meta.dirname, 'out');

/** Klucze źródłowe produktów, które już są w katalogu (seed) */
export function catalogKeys(): Set<string> {
  const keys = new Set<string>();
  for (const v of Object.values(usdaCatalogData as Record<string, { fdcId: number }>))
    keys.add(`usda:${v.fdcId}`);
  for (const i of CIQUAL_CATALOG) keys.add(`ciqual:${i.ciqual}`);
  return keys;
}

export interface EtlResult {
  candidates: Candidate[];
  rejected: { food: SourceFood; reason: RejectReason | 'IN_CATALOG' }[];
  counts: Record<string, number>;
}

export function runEtl(ciqual: SourceFood[], usda: SourceFood[], existing: Set<string>): EtlResult {
  const rejected: EtlResult['rejected'] = [];
  const keep = (foods: SourceFood[]) =>
    foods.filter((food) => {
      const reason = selectFood(food);
      if (reason) rejected.push({ food, reason });
      return !reason;
    });
  const all = dedupe(keep(ciqual), keep(usda));
  // Już w Cookivo: główna pozycja albo którykolwiek scalony duplikat ma kod z katalogu
  const candidates = all.filter((c) => {
    const inCatalog = [c.importKey, ...c.merged.map((m) => m.key)].some((k) => existing.has(k));
    if (inCatalog) {
      rejected.push({
        food: { ...c, key: c.importKey, portions: c.portions } as unknown as SourceFood,
        reason: 'IN_CATALOG',
      });
    }
    return !inCatalog;
  });
  const counts: Record<string, number> = {
    ciqual: ciqual.length,
    usda: usda.length,
    candidates: candidates.length,
    candidatesCiqual: candidates.filter((c) => c.source === 'CIQUAL').length,
    candidatesUsda: candidates.filter((c) => c.source === 'USDA').length,
    mergedSameSource: all.reduce((n, c) => n + c.merged.filter((m) => m.reason === 'SAME_SOURCE').length, 0),
    mergedCrossSource: all.reduce(
      (n, c) => n + c.merged.filter((m) => m.reason === 'OTHER_SOURCE').length,
      0,
    ),
  };
  for (const r of rejected) counts[`rejected:${r.reason}`] = (counts[`rejected:${r.reason}`] ?? 0) + 1;
  return { candidates, rejected, counts };
}

async function main() {
  const [ciqualDir, usdaDir] = process.argv.slice(2);
  if (!ciqualDir || !usdaDir) {
    console.error('Użycie: npx tsx prisma/import/etl.ts <katalog-ciqual-xml> <katalog-usda-csv>');
    process.exit(1);
  }
  const ciqual = readCiqual(ciqualDir);
  const usda = await readUsda(usdaDir);
  const { candidates, rejected, counts } = runEtl(ciqual, usda, catalogKeys());

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(OUT_DIR, 'candidates.jsonl'),
    candidates.map((c) => JSON.stringify(c)).join('\n') + '\n',
  );
  writeFileSync(
    join(OUT_DIR, 'etl-odrzucone.csv'),
    csv(
      ['klucz', 'nazwa_en', 'grupa', 'powod'],
      rejected.map((r) => [r.food.key, r.food.nameEn, `${r.food.group} ${r.food.groupName}`, r.reason]),
    ),
  );
  writeFileSync(
    join(OUT_DIR, 'etl-scalone.csv'),
    csv(
      ['klucz', 'nazwa_en', 'scalony_klucz', 'scalona_nazwa_en', 'rodzaj'],
      candidates.flatMap((c) => c.merged.map((m) => [c.importKey, c.nameEn, m.key, m.nameEn, m.reason])),
    ),
  );
  writeFileSync(join(OUT_DIR, 'etl-podsumowanie.json'), JSON.stringify(counts, null, 2) + '\n');
  console.log(counts);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) await main();
