/**
 * Ręczna weryfikacja rekordów PENDING (Excel zamiast panelu admina).
 *
 *   npx tsx prisma/import/review.ts export            → prisma/import/review/do-weryfikacji.csv
 *   npx tsx prisma/import/review.ts apply <plik.csv>  → prisma/import/review-decisions.json
 *
 * Po "apply" uruchom build (npm run ingredients:build) - zatwierdzone rekordy trafią do pliku
 * importowego jako APPROVED, a kolejny import doda tylko je (już zaimportowane są pomijane).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DECISIONS_FILE, IMPORT_FILE, readDecisions } from './build.js';
import type { ImportRecord } from './lib/record.js';
import { exportReview, readReview } from './lib/review.js';

function main() {
  const [mode, file] = process.argv.slice(2);
  const records = readFileSync(IMPORT_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ImportRecord);

  if (mode === 'export') {
    const dir = join(import.meta.dirname, 'review');
    mkdirSync(dir, { recursive: true });
    const out = join(dir, 'do-weryfikacji.csv');
    writeFileSync(out, exportReview(records));
    console.log(`Zapisano ${records.filter((r) => r.status === 'PENDING').length} rekordów do ${out}`);
    return;
  }
  if (mode === 'apply' && file) {
    const res = readReview(records, readFileSync(file, 'utf8'));
    const decisions = { ...readDecisions(), ...res.decisions };
    writeFileSync(DECISIONS_FILE, JSON.stringify(decisions, null, 1) + '\n');
    console.log(`Zatwierdzone: ${res.approved}, pominięte: ${res.skipped}, błędy: ${res.errors.length}`);
    if (res.errors.length) console.log(res.errors.slice(0, 50).join('\n'));
    console.log('Teraz: npm run ingredients:build');
    return;
  }
  console.error('Użycie: review.ts export | review.ts apply <plik.csv>');
  process.exit(1);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) main();
