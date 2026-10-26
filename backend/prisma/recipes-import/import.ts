/**
 * Krok 5 importu przepisów: plik importowy → baza (ręcznie, bez crona).
 *
 *   IMPORT_DATABASE_URL=... npx tsx prisma/recipes-import/import.ts --dry-run [--limit N]
 *   IMPORT_DATABASE_URL=... npx tsx prisma/recipes-import/import.ts --commit [--limit N]
 *   IMPORT_DATABASE_URL=... npx tsx prisma/recipes-import/import.ts --undo [--commit]
 *
 * Adres bazy tylko z IMPORT_DATABASE_URL (celowo nie DATABASE_URL). Zdjęcia muszą być na serwerze
 * przed zapisem (workflow najpierw wgrywa pliki). Raport: konsola + out/import-*.json.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { join } from 'node:path';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import type { UnitEstimates } from './lib/build.js';
import { IMPORT_FILE, OUT, UNIT_ESTIMATES, ensureOut, readJson, readJsonl, writeJson } from './lib/files.js';
import { runImport, undoImport } from './lib/importer.js';
import type { RecipeRecord } from './lib/record.js';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--commit');
  const limitArg = args.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : undefined;
  const url = process.env.IMPORT_DATABASE_URL;
  if (!url) throw new Error('Ustaw IMPORT_DATABASE_URL (adres bazy docelowej).');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const host = new URL(url).hostname;
    console.log(`Baza: ${host} · tryb: ${dryRun ? 'DRY RUN (bez zapisu)' : 'ZAPIS'}`);
    if (args.includes('--undo')) {
      const res = await undoImport(prisma, dryRun);
      console.log(
        dryRun
          ? `Do usunięcia: ${res.removable}; zostają (używane): ${res.kept}. Uruchom z --commit, żeby usunąć.`
          : `Usunięto: ${res.removable}; zostały (używane): ${res.kept}.`,
      );
      return;
    }
    const records = readJsonl<RecipeRecord>(IMPORT_FILE);
    const unitEstimates = readJson<UnitEstimates>(UNIT_ESTIMATES, {});
    const report = await runImport(prisma, records, { dryRun, limit, unitEstimates, log: console.log });
    const { plan, ...summary } = report;
    console.log(summary);
    ensureOut();
    const file = join(OUT, `import-${report.mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeJson(file, {
      host,
      ...summary,
      skippedRecords: plan
        .filter((p) => p.action !== 'INSERT')
        .map((p) => ({ key: p.record.key, title: p.record.title, action: p.action, detail: p.detail })),
    });
    console.log(`Raport: ${file}`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
