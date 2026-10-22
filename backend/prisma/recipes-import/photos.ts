/**
 * Zdjęcia przepisów z Wikimedia Commons (tylko wolne licencje, z autorem i licencją):
 *
 *   npx tsx prisma/recipes-import/photos.ts meta
 *       metadane i licencje zdjęć dla przepisów wybranych przez build (cache: photo-cache.json);
 *       zdjęcie pobiera się raz, żeby poznać wymiary - pliki WebP lądują w out/photos/
 *   npx tsx prisma/recipes-import/photos.ts files --dir <katalog>
 *       pliki WebP (3 rozmiary) wszystkich zdjęć z pliku importu, których brak w katalogu
 *       (w workflow przed wgraniem przez FTP do UPLOADS_DIR)
 *
 * Nigdy nie generujemy zdjęć - przepis bez zdjęcia z wolną licencją zostaje bez zdjęcia.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { PHOTO_WIDTHS, webpVariants } from '../../src/photos/webp.js';
import { uuidv7 } from '../import/lib/importer.js';
import type { PhotoCache } from './build.js';
import { readStructureCache } from './ai.js';
import { IMPORT_FILE, OUT, PHOTO_CACHE, readCatalog, readJson, readJsonl, writeJson } from './lib/files.js';
import type { RecipeRecord } from './lib/record.js';
import { allowedPhotoLicense, commonsFiles, download, type CommonsFile } from './lib/wiki.js';
import { rankImages } from './lib/wikitext.js';

/** Zapisuje 3 rozmiary WebP; zwraca wymiary i rozmiar jak przy uploadzie w aplikacji */
async function convert(buffer: Buffer, id: string, dir: string) {
  const v = await webpVariants(sharp(buffer, { limitInputPixels: 50_000_000 }).rotate());
  mkdirSync(dir, { recursive: true });
  for (const f of v.files) writeFileSync(join(dir, `${id}-${f.width}.webp`), f.data);
  return { width: v.width, height: v.height, bytes: v.bytes };
}

/** Czy plik z Commons nadaje się na zdjęcie przepisu (licencja, autor, format, rozmiar) */
function verdict(f: CommonsFile | null): string | null {
  if (!f) return 'brak pliku na Commons (plik lokalny Wikibooks)';
  if (!/^image\/(jpeg|png|webp|tiff)$/.test(f.mime)) return `format ${f.mime}`;
  if (!allowedPhotoLicense(f.license)) return `licencja: ${f.license || 'brak'}`;
  if (f.attributionRequired && !f.author) return 'licencja wymaga autora, a go brak';
  if (Math.min(f.width, f.height) < 400) return `za małe (${f.width}×${f.height})`;
  return null;
}

async function meta() {
  const catalog = readCatalog();
  const structure = readStructureCache();
  const cache = readJson<PhotoCache>(PHOTO_CACHE, {});
  // Zdjęcie strony dostaje pierwszy przepis - tylko strony, których pierwszy przepis przechodzi
  const pages = [...catalog.values()].filter((e) =>
    ['READY', 'WAITING_TRANSLATION'].includes(e.recipes?.[0]?.status ?? ''),
  );
  const ranked = new Map(
    pages.map((e) => [e.key, rankImages(structure.items[e.key]?.images ?? [], e.title)]),
  );
  // 1. Licencje i wymiary (bez pobierania plików)
  const unknown = [...new Set([...ranked.values()].flat())].filter((f) => !cache[f]);
  console.log(`Zdjęcia do sprawdzenia: ${unknown.length}`);
  for (const [file, f] of await commonsFiles(unknown)) {
    const bad = verdict(f);
    cache[file] = bad ? { ok: false, reason: bad } : { ok: true, info: f! };
  }
  writeJson(PHOTO_CACHE, cache);
  // 2. Na stronę pobieramy tylko pierwsze pasujące zdjęcie
  const dir = join(OUT, 'photos');
  for (const [key, files] of ranked) {
    if (files.some((f) => cache[f]?.photo)) continue;
    for (const file of files) {
      const entry = cache[file];
      if (!entry?.ok || !entry.info) continue;
      const f = entry.info;
      try {
        const id = uuidv7();
        const size = await convert(await download(f.thumbUrl), id, dir);
        entry.photo = {
          id,
          file,
          thumbUrl: f.thumbUrl,
          ...size,
          author: f.author,
          license: f.license,
          licenseUrl: f.licenseUrl,
          sourceUrl: f.descriptionUrl,
        };
        console.log(`  ✓ ${key}: ${file} (${f.license}, ${f.author ?? '-'})`);
        break;
      } catch (err) {
        cache[file] = { ok: false, reason: `pobieranie: ${(err as Error).message}` };
      }
    }
    writeJson(PHOTO_CACHE, cache);
  }
  console.log('Gotowe. Teraz: build.ts');
}

async function files(dir: string) {
  const records = readJsonl<RecipeRecord>(IMPORT_FILE).filter((r) => r.photo);
  let made = 0;
  for (const r of records) {
    const p = r.photo!;
    const have = Object.values(PHOTO_WIDTHS).every((w) => existsSync(join(dir, `${p.id}-${w}.webp`)));
    if (have) continue;
    await convert(await download(p.thumbUrl), p.id, dir);
    made++;
  }
  console.log(`Zdjęcia: ${records.length} w pliku importu, utworzone teraz: ${made} (${dir}).`);
}

const [cmd] = process.argv.slice(2);
const dirArg = process.argv.indexOf('--dir');
if (cmd === 'meta') await meta();
else if (cmd === 'files' && dirArg > 0) await files(process.argv[dirArg + 1]);
else console.error('Użycie: photos.ts meta | files --dir <katalog>');
