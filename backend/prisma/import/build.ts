/**
 * Krok 3 importu składników: kandydaci + cache AI → plik importowy i raporty.
 *
 *   npx tsx prisma/import/build.ts
 *
 * Wynik: prisma/import/ingredients.import.jsonl (w repozytorium - import nie wymaga ponownego
 * przetwarzania źródeł) oraz raporty CSV i raport.md w prisma/import/out/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALLERGENS, CATEGORIES, UNITS } from '../seed/reference-data.js';
import { catalogNames, readCache, readCandidates } from './ai.js';
import { buildRecords } from './lib/build.js';
import { validateRecord, type ImportRecord } from './lib/record.js';
import { csv } from './lib/report.js';
import { applyDecisions, type Decision } from './lib/review.js';

export const IMPORT_FILE = join(import.meta.dirname, 'ingredients.import.jsonl');
/** Decyzje z ręcznej weryfikacji (review.ts apply) - stosowane przy każdej przebudowie */
export const DECISIONS_FILE = join(import.meta.dirname, 'review-decisions.json');

export function readDecisions(): Record<string, Decision> {
  return existsSync(DECISIONS_FILE)
    ? (JSON.parse(readFileSync(DECISIONS_FILE, 'utf8')) as Record<string, Decision>)
    : {};
}
const OUT = join(import.meta.dirname, 'out');

export const dictionaries = () => ({
  categories: new Set<string>(CATEGORIES.map((c) => c.code)),
  allergens: new Set<string>(ALLERGENS.map((a) => a.code)),
  units: new Set<string>(UNITS.map((u) => u.code)),
});

function main() {
  const candidates = readCandidates();
  const cache = readCache('');
  const { records, skipped } = buildRecords(candidates, cache, catalogNames());
  const reviewed = applyDecisions(records, readDecisions());
  if (reviewed) console.log(`Zastosowano ręczne decyzje: ${reviewed}`);
  const d = dictionaries();
  const valid: ImportRecord[] = [];
  const invalid: { r: ImportRecord; errors: string[] }[] = [];
  for (const r of records) {
    const errors = validateRecord(r, d.categories, d.allergens, d.units);
    if (errors.length) invalid.push({ r, errors });
    else valid.push(r);
  }

  writeFileSync(IMPORT_FILE, valid.map((r) => JSON.stringify(r)).join('\n') + '\n');
  mkdirSync(OUT, { recursive: true });
  const reasons = (s: string) => skipped.filter((x) => x.reason === s);
  writeFileSync(
    join(OUT, 'duplikaty.csv'),
    csv(
      ['zachowany', 'nazwa_pl', 'pominiety_klucz', 'nazwa_en', 'powod'],
      [
        ...valid.flatMap((r) => r.duplicates.map((k) => [r.importKey, r.namePl, k, '', 'scalony'])),
        ...skipped
          .filter((s) => ['SAME_AS_EXISTING', 'EXISTING_NAME'].includes(s.reason))
          .map((s) => ['(Cookivo)', s.detail, s.candidate.importKey, s.candidate.nameEn, s.reason]),
      ],
    ),
  );
  writeFileSync(
    join(OUT, 'odrzucone.csv'),
    csv(
      ['klucz', 'nazwa_en', 'powod', 'szczegoly'],
      [
        ...skipped
          .filter((s) => !['SAME_AS_EXISTING', 'EXISTING_NAME', 'DUPLICATE_PL_NAME'].includes(s.reason))
          .map((s) => [s.candidate.importKey, s.candidate.nameEn, s.reason, s.detail]),
        ...invalid.map((x) => [x.r.importKey, x.r.nameEn, 'INVALID', x.errors.join(',')]),
      ],
    ),
  );
  writeFileSync(
    join(OUT, 'niekompletne.csv'),
    csv(
      ['klucz', 'nazwa_pl', 'brakujace_wartosci', 'uzupelnione_z'],
      valid
        .filter((r) => r.quality.missing.length || r.quality.filledFrom.length)
        .map((r) => [
          r.importKey,
          r.namePl,
          r.quality.missing.join(','),
          r.quality.filledFrom.map((f) => `${f.field}<${f.key}`).join(','),
        ]),
    ),
  );
  writeFileSync(
    join(OUT, 'do-weryfikacji.csv'),
    csv(
      ['klucz', 'nazwa_pl', 'kategoria', 'alergeny', 'powody'],
      valid
        .filter((r) => r.status === 'PENDING')
        .map((r) => [r.importKey, r.namePl, r.categoryCode, r.allergens.join(','), r.review.join(' ')]),
    ),
  );

  const byCategory = new Map<string, { all: number; approved: number }>();
  for (const r of valid) {
    const e = byCategory.get(r.categoryCode) ?? { all: 0, approved: 0 };
    e.all++;
    if (r.status === 'APPROVED') e.approved++;
    byCategory.set(r.categoryCode, e);
  }
  const summary = {
    candidates: candidates.length,
    withAi: candidates.filter((c) => cache.items[c.importKey]).length,
    records: valid.length,
    approved: valid.filter((r) => r.status === 'APPROVED').length,
    pending: valid.filter((r) => r.status === 'PENDING').length,
    incomplete: valid.filter((r) => r.quality.missing.length).length,
    skipped: Object.fromEntries(
      ['NO_AI', 'RARE', 'SAME_AS_EXISTING', 'EXISTING_NAME', 'DUPLICATE_PL_NAME', 'INVALID'].map((s) => [
        s,
        reasons(s).length,
      ]),
    ),
    invalid: invalid.length,
  };
  const name = (code: string) => CATEGORIES.find((c) => c.code === code)?.pl ?? code;
  writeFileSync(
    join(OUT, 'raport-build.md'),
    [
      '# Plik importowy składników',
      '',
      '```json',
      JSON.stringify(summary, null, 2),
      '```',
      '',
      '| Kategoria | Razem | Zatwierdzone od razu |',
      '| --- | ---: | ---: |',
      ...[...byCategory.entries()]
        .sort((a, b) => b[1].all - a[1].all)
        .map(([code, e]) => `| ${name(code)} | ${e.all} | ${e.approved} |`),
      '',
    ].join('\n'),
  );
  console.log(summary);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) main();
