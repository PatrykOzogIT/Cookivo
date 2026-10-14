/**
 * Narzędzie (uruchamiane ręcznie, nie w produkcji): wyciąga wartości odżywcze z tabeli
 * ANSES Ciqual 2025 (Licence Ouverte 2.0) dla składników z `ingredients.ciqual.ts`
 * i zapisuje je do `ciqual.data.json`.
 *
 *   1. Pobierz pliki XML (alim, compo, const) ze strony zbioru Ciqual:
 *      https://entrepot.recherche.data.gouv.fr/dataset.xhtml?persistentId=doi:10.57745/RDMHWY
 *   2. npx tsx prisma/seed/tools/ciqual-extract.ts <katalog-z-xml>
 *      npx tsx prisma/seed/tools/ciqual-extract.ts <katalog-z-xml> --search "fromage blanc"
 *
 * Ciqual podaje wartości już w standardzie etykiety UE (energia wg 1169/2011, węglowodany
 * przyswajalne bez błonnika, sól). Wartości nieliczbowe:
 *  - "-"      → null (brak danych),
 *  - "traces" → 0,
 *  - "< x"    → 0 (poniżej progu oznaczalności; etykieta UE dopuszcza wtedy 0).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CIQUAL_CATALOG } from '../ingredients.ciqual.js';

/** Kody składników odżywczych w Ciqual (plik const_*.xml) */
const NUTRIENTS = {
  328: 'kcal',
  25000: 'protein',
  40000: 'fat',
  40302: 'saturatedFat',
  31000: 'carbs',
  32000: 'sugars',
  34100: 'fiber',
  10004: 'salt',
} as const;

type Key = (typeof NUTRIENTS)[keyof typeof NUTRIENTS];
const REQUIRED: Key[] = ['kcal', 'protein', 'fat', 'carbs'];

export interface CiqualValues {
  nameFr: string;
  nameEn: string;
  kcal: number;
  protein: number;
  fat: number;
  saturatedFat: number | null;
  carbs: number;
  sugars: number | null;
  fiber: number | null;
  salt: number | null;
}

const ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&apos;': "'",
  '&quot;': '"',
};
const decode = (s: string) => s.replace(/&(lt|gt|amp|apos|quot);/g, (e) => ENTITIES[e]).trim();

/** "12,5" → 12.5; "-" → null; "traces" / "< 0,5" → 0 */
export function parseCiqualValue(raw: string): number | null {
  const v = decode(raw);
  if (v === '' || v === '-') return null;
  if (v === 'traces' || v.startsWith('<')) return 0;
  const n = Number(v.replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(`Nieznana wartość w Ciqual: "${raw}"`);
  return Math.round(n * 100) / 100;
}

function findFile(dir: string, prefix: string): string {
  const name = readdirSync(dir).find((f) => f.startsWith(prefix) && f.endsWith('.xml'));
  if (!name) throw new Error(`Brak pliku ${prefix}*.xml w ${dir}`);
  return join(dir, name);
}

function readFoods(dir: string): Map<number, { fr: string; en: string }> {
  const xml = readFileSync(findFile(dir, 'alim_2'), 'utf8');
  const foods = new Map<number, { fr: string; en: string }>();
  for (const m of xml.matchAll(/<ALIM>([\s\S]*?)<\/ALIM>/g)) {
    const tag = (t: string) => decode(m[1].match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1] ?? '');
    foods.set(Number(tag('alim_code')), { fr: tag('alim_nom_fr'), en: tag('alim_nom_eng') });
  }
  return foods;
}

function main() {
  const [dir, flag, query] = process.argv.slice(2);
  if (!dir) {
    console.error('Użycie: npx tsx prisma/seed/tools/ciqual-extract.ts <katalog-z-xml> [--search "tekst"]');
    process.exit(1);
  }
  const foods = readFoods(dir);

  if (flag === '--search') {
    const q = (query ?? '').toLowerCase();
    for (const [code, f] of foods) {
      if (`${f.fr} | ${f.en}`.toLowerCase().includes(q)) console.log(`${code}\t${f.fr}\t${f.en}`);
    }
    return;
  }

  const wanted = new Set(CIQUAL_CATALOG.map((i) => i.ciqual));
  const values = new Map<number, Partial<Record<Key, number | null>>>();
  const compo = readFileSync(findFile(dir, 'compo_'), 'utf8');
  const re =
    /<alim_code>\s*(\d+)\s*<\/alim_code>\s*<const_code>\s*(\d+)\s*<\/const_code>\s*<teneur>([^<]*)<\/teneur>/g;
  for (const m of compo.matchAll(re)) {
    const code = Number(m[1]);
    const key = NUTRIENTS[Number(m[2]) as keyof typeof NUTRIENTS];
    if (!key || !wanted.has(code)) continue;
    const row = values.get(code) ?? {};
    row[key] = parseCiqualValue(m[3]);
    values.set(code, row);
  }

  const out: Record<string, CiqualValues> = {};
  const problems: string[] = [];
  for (const item of CIQUAL_CATALOG) {
    const food = foods.get(item.ciqual);
    const v = values.get(item.ciqual);
    if (!food || !v) {
      problems.push(`${item.pl}: brak produktu ${item.ciqual} w Ciqual`);
      continue;
    }
    const missing = REQUIRED.filter((k) => v[k] == null);
    if (missing.length) {
      problems.push(`${item.pl} (${item.ciqual}): brak ${missing.join(', ')}`);
      continue;
    }
    out[String(item.ciqual)] = {
      nameFr: food.fr,
      nameEn: food.en,
      kcal: v.kcal!,
      protein: v.protein!,
      fat: v.fat!,
      saturatedFat: v.saturatedFat ?? null,
      carbs: v.carbs!,
      sugars: v.sugars ?? null,
      fiber: v.fiber ?? null,
      salt: v.salt ?? null,
    };
  }

  if (problems.length) {
    console.error('Do poprawienia w katalogu:\n' + problems.map((p) => `  - ${p}`).join('\n'));
    process.exit(1);
  }
  const target = join(import.meta.dirname, '..', 'ciqual.data.json');
  writeFileSync(target, JSON.stringify(out, null, 2) + '\n');
  console.log(`Zapisano ${Object.keys(out).length} produktów do ${target}`);
}

main();
