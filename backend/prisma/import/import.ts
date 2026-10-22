/**
 * Krok 4 importu składników: plik importowy → baza (ręcznie, bez crona).
 *
 *   IMPORT_DATABASE_URL=... npx tsx prisma/import/import.ts --dry-run [--limit N]
 *   IMPORT_DATABASE_URL=... npx tsx prisma/import/import.ts --commit [--limit N]
 *   IMPORT_DATABASE_URL=... npx tsx prisma/import/import.ts --undo [--commit]
 *
 * Adres bazy tylko z IMPORT_DATABASE_URL (celowo nie DATABASE_URL - żeby nie trafić w bazę
 * przez pomyłkę). Raport trafia na konsolę i do prisma/import/out/import-*.json.
 */
import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { dictionaries, IMPORT_FILE } from './build.js';
import { runImport, undoImport } from './lib/importer.js';
import { validateRecord, type ImportRecord } from './lib/record.js';

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes('--commit');
  const dryRun = !commit;
  const limitArg = args.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : undefined;
  const url = process.env.IMPORT_DATABASE_URL;
  if (!url) throw new Error('Ustaw IMPORT_DATABASE_URL (adres bazy docelowej).');

  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    const host = new URL(url).hostname;
    console.log(`Baza: ${host} · tryb: ${dryRun ? 'DRY RUN (bez zapisu)' : 'ZAPIS'}`);

    if (args.includes('--undo')) {
      const res = await undoImport(db, dryRun);
      console.log(
        dryRun
          ? `Do usunięcia: ${res.removable}; zostają (używane): ${res.kept}. Uruchom z --commit, żeby usunąć.`
          : `Usunięto: ${res.removable}; zostały (używane): ${res.kept}.`,
      );
      return;
    }

    const records = readFileSync(IMPORT_FILE, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ImportRecord);
    const d = dictionaries();
    const invalid = records
      .map((r) => ({ r, errors: validateRecord(r, d.categories, d.allergens, d.units) }))
      .filter((x) => x.errors.length);
    if (invalid.length) {
      console.error(
        invalid
          .slice(0, 20)
          .map((x) => `${x.r.importKey}: ${x.errors.join(',')}`)
          .join('\n'),
      );
      throw new Error(`Plik ma ${invalid.length} niepoprawnych wierszy - przerwano przed zapisem.`);
    }

    const report = await runImport(db, records, { dryRun, limit, log: console.log });
    const { plan, ...summary } = report;
    console.log(summary);
    const out = join(import.meta.dirname, 'out');
    mkdirSync(out, { recursive: true });
    const file = join(out, `import-${report.mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        {
          host,
          ...summary,
          skippedRecords: plan
            .filter((p) => p.action !== 'INSERT')
            .map((p) => ({
              key: p.record.importKey,
              name: p.record.namePl,
              action: p.action,
              detail: p.detail,
            })),
        },
        null,
        2,
      ),
    );
    console.log(`Raport: ${file}`);
  } finally {
    await db.end();
  }
}

await main();
