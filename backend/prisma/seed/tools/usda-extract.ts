/**
 * Narzędzie (uruchamiane ręcznie, nie w produkcji): wyciąga wartości odżywcze
 * z bazy USDA FoodData Central - SR Legacy (domena publiczna) dla składników
 * z `ingredients.catalog.ts` i zapisuje je do `ingredients.data.json`.
 *
 *   1. Pobierz i rozpakuj CSV:
 *      https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip
 *   2. npx tsx prisma/seed/tools/usda-extract.ts <katalog-z-csv>
 *      npx tsx prisma/seed/tools/usda-extract.ts <katalog-z-csv> --search "Apples, raw"
 *
 * Przeliczenia na standard etykiety UE (rozporządzenie 1169/2011):
 *  - węglowodany = "carbohydrate by difference" - błonnik (w UE błonnik liczony osobno),
 *    ale nie mniej niż cukry,
 *  - sól = sód × 2,5.
 */
import { createReadStream, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { INGREDIENT_CATALOG } from '../ingredients.catalog.js';

const NUTRIENTS = {
  1008: 'kcal',
  1003: 'protein',
  1004: 'fat',
  1258: 'saturatedFat',
  1005: 'carbsByDifference',
  2000: 'sugars',
  1079: 'fiber',
  1093: 'sodiumMg',
} as const;

type NutrientKey = (typeof NUTRIENTS)[keyof typeof NUTRIENTS];

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

async function* rows(file: string) {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let header = true;
  for await (const line of rl) {
    if (header) {
      header = false;
      continue;
    }
    if (line) yield parseCsvLine(line);
  }
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

async function main() {
  const [dir, flag, query] = process.argv.slice(2);
  if (!dir) throw new Error('Podaj katalog z plikami CSV USDA');

  const foods = new Map<string, number>(); // opis → fdc_id
  for await (const [id, , description] of rows(join(dir, 'food.csv'))) foods.set(description, Number(id));

  if (flag === '--search') {
    const re = new RegExp(query ?? '', 'i');
    for (const d of [...foods.keys()]
      .filter((d) => re.test(d))
      .sort()
      .slice(0, 400))
      console.log(d);
    return;
  }

  const wanted = new Map<number, string>();
  const missing: string[] = [];
  for (const item of INGREDIENT_CATALOG) {
    const id = foods.get(item.usda);
    if (id) wanted.set(id, item.usda);
    else missing.push(`${item.pl}  →  "${item.usda}"`);
  }
  if (missing.length) {
    console.error(`Nie znaleziono ${missing.length} opisów USDA:\n  ${missing.join('\n  ')}`);
    process.exitCode = 1;
  }

  const values = new Map<number, Partial<Record<NutrientKey, number>>>();
  for await (const [, fdcId, nutrientId, amount] of rows(join(dir, 'food_nutrient.csv'))) {
    const id = Number(fdcId);
    const key = NUTRIENTS[Number(nutrientId) as keyof typeof NUTRIENTS];
    if (!key || !wanted.has(id)) continue;
    const v = values.get(id) ?? {};
    v[key] = Number(amount);
    values.set(id, v);
  }

  const result: Record<string, unknown> = {};
  for (const item of INGREDIENT_CATALOG) {
    const id = foods.get(item.usda);
    if (!id) continue;
    const v = values.get(id) ?? {};
    // Brak wartości w USDA zapisujemy jako null ("brak danych"), a nie 0
    const opt = (n: number | undefined, d = 1) => (n === undefined ? null : round(n, d));
    result[item.usda] = {
      fdcId: id,
      kcal: round(v.kcal ?? 0, 0),
      protein: round(v.protein ?? 0),
      fat: round(v.fat ?? 0),
      saturatedFat: opt(v.saturatedFat),
      // W UE węglowodany zawsze obejmują cukry - USDA mierzy je różnymi metodami (np. laktoza w mleku)
      carbs: round(Math.max(0, (v.carbsByDifference ?? 0) - (v.fiber ?? 0), v.sugars ?? 0)),
      sugars: opt(v.sugars),
      fiber: opt(v.fiber),
      salt: v.sodiumMg === undefined ? null : round((v.sodiumMg * 2.5) / 1000, 2),
    };
  }

  const out = join(import.meta.dirname, '..', 'ingredients.data.json');
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  console.log(`Zapisano ${Object.keys(result).length} składników do ${out}`);
}

await main();
