import { createReadStream, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { NUTRIENT_KEYS, type Nutrition, type Portion, type PortionUnit, type SourceFood } from './types.js';

/*
 * Odczyt pełnych eksportów źródeł (bez API):
 *  - ANSES Ciqual 2025 (XML, Licence Ouverte 2.0) - wartości już w standardzie etykiety UE,
 *  - USDA FoodData Central SR Legacy (CSV, domena publiczna) - przeliczamy na standard UE.
 * Reguły wartości te same co w prisma/seed/tools (seed katalogu).
 */

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

// --- Ciqual ---------------------------------------------------------------------------------

const CIQUAL_NUTRIENTS: Record<number, keyof Nutrition> = {
  328: 'kcal',
  25000: 'protein',
  40000: 'fat',
  40302: 'saturatedFat',
  31000: 'carbs',
  32000: 'sugars',
  34100: 'fiber',
  10004: 'salt',
};

const ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&apos;': "'",
  '&quot;': '"',
};
const decode = (s: string) => s.replace(/&(lt|gt|amp|apos|quot);/g, (e) => ENTITIES[e]).trim();

/** "12,5" → 12.5; "-" lub puste → null; "traces" / "< 0,5" → 0 (poniżej progu oznaczalności) */
export function parseCiqualValue(raw: string): number | null {
  const v = decode(raw);
  if (v === '' || v === '-') return null;
  if (v === 'traces' || v.startsWith('<')) return 0;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? round(n, 2) : null;
}

function findFile(dir: string, prefix: string): string {
  const name = readdirSync(dir).find((f) => f.startsWith(prefix) && f.endsWith('.xml'));
  if (!name) throw new Error(`Brak pliku ${prefix}*.xml w ${dir}`);
  return join(dir, name);
}

const tag = (block: string, name: string) =>
  decode(block.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? '');

export function readCiqual(dir: string): SourceFood[] {
  const groups = new Map<string, string>();
  for (const m of readFileSync(findFile(dir, 'alim_grp'), 'utf8').matchAll(
    /<ALIM_GRP>([\s\S]*?)<\/ALIM_GRP>/g,
  )) {
    groups.set(tag(m[1], 'alim_ssgrp_code'), tag(m[1], 'alim_ssgrp_nom_eng'));
  }
  const values = new Map<string, Nutrition>();
  const compo = readFileSync(findFile(dir, 'compo_'), 'utf8');
  const re =
    /<alim_code>\s*(\d+)\s*<\/alim_code>\s*<const_code>\s*(\d+)\s*<\/const_code>\s*<teneur>([^<]*)<\/teneur>/g;
  for (const m of compo.matchAll(re)) {
    const key = CIQUAL_NUTRIENTS[Number(m[2])];
    if (!key) continue;
    const row = values.get(m[1]) ?? emptyNutrition();
    row[key] = parseCiqualValue(m[3]);
    values.set(m[1], row);
  }
  const foods: SourceFood[] = [];
  for (const m of readFileSync(findFile(dir, 'alim_2'), 'utf8').matchAll(/<ALIM>([\s\S]*?)<\/ALIM>/g)) {
    const code = tag(m[1], 'alim_code');
    const group = tag(m[1], 'alim_ssgrp_code');
    foods.push({
      key: `ciqual:${code}`,
      source: 'CIQUAL',
      ref: code,
      nameEn: tag(m[1], 'alim_nom_eng'),
      nameFr: tag(m[1], 'alim_nom_fr'),
      group,
      groupName: groups.get(group) ?? '',
      values: values.get(code) ?? emptyNutrition(),
      portions: [],
    });
  }
  return foods;
}

// --- USDA -----------------------------------------------------------------------------------

const USDA_NUTRIENTS = {
  1008: 'kcal',
  1003: 'protein',
  1004: 'fat',
  1258: 'saturatedFat',
  1005: 'carbsByDifference',
  2000: 'sugars',
  1079: 'fiber',
  1093: 'sodiumMg',
} as const;
type UsdaKey = (typeof USDA_NUTRIENTS)[keyof typeof USDA_NUTRIENTS];

export function parseCsvLine(line: string): string[] {
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

async function* csvRows(file: string) {
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

/**
 * Wartości USDA → standard etykiety UE (rozporządzenie 1169/2011):
 * węglowodany = "by difference" - błonnik (nie mniej niż cukry), sól = sód × 2,5.
 * Brak wartości zostaje null - nie zamieniamy na 0.
 */
export function usdaToEu(v: Partial<Record<UsdaKey, number>>): Nutrition {
  const opt = (n: number | undefined, d = 1) => (n === undefined ? null : round(n, d));
  const carbs =
    v.carbsByDifference === undefined
      ? null
      : round(Math.max(0, v.carbsByDifference - (v.fiber ?? 0), v.sugars ?? 0), 1);
  return {
    kcal: v.kcal === undefined ? null : round(v.kcal, 0),
    protein: opt(v.protein),
    fat: opt(v.fat),
    saturatedFat: opt(v.saturatedFat),
    carbs,
    sugars: opt(v.sugars),
    fiber: opt(v.fiber),
    salt: v.sodiumMg === undefined ? null : round((v.sodiumMg * 2.5) / 1000, 2),
  };
}

/** Szklanka w Polsce = 250 ml, amerykański "cup" = 236,6 ml */
const CUP_TO_GLASS = 250 / 236.6;

/**
 * Porcja USDA ("cup, chopped", "medium (2-3/4" dia)", "tbsp") → jednostka Cookivo.
 * Zwraca null dla porcji, których nie przekładamy (oz, lb, serving, package…).
 */
export function mapUsdaPortion(modifier: string, amount: number, grams: number): Portion | null {
  const m = modifier.trim().toLowerCase();
  if (!(amount > 0) || !(grams > 0)) return null;
  const per = grams / amount;
  const first = m.split(/[\s,(]/)[0];
  let unit: PortionUnit | null = null;
  let factor = 1;
  if (first === 'tbsp' || first === 'tablespoon') unit = 'TABLESPOON';
  else if (first === 'tsp' || first === 'teaspoon') unit = 'TEASPOON';
  else if (first === 'cup') {
    unit = 'GLASS';
    factor = CUP_TO_GLASS;
  } else if (first === 'slice') unit = 'SLICE';
  else if (first === 'clove') unit = 'CLOVE';
  else if (
    ['medium', 'fruit', 'piece', 'item', 'unit', 'each', 'whole', 'large', 'small', 'egg'].includes(first)
  )
    unit = 'PIECE';
  if (!unit) return null;
  const value = round(per * factor, 1);
  return value > 0 && value <= 5000 ? { unit, grams: value, label: modifier } : null;
}

/** Jedna porcja na jednostkę: dla sztuk najpierw "medium", potem ogólne, na końcu duże/małe */
function pickPortions(all: Portion[]): Portion[] {
  const rank = (p: Portion) => {
    const first = p.label
      .trim()
      .toLowerCase()
      .split(/[\s,(]/)[0];
    if (p.unit !== 'PIECE') return 0;
    return ['medium', 'fruit', 'piece', 'item', 'unit', 'each', 'whole', 'egg'].includes(first)
      ? first === 'medium'
        ? 0
        : 1
      : 2;
  };
  const best = new Map<PortionUnit, Portion>();
  for (const p of all) {
    const cur = best.get(p.unit);
    if (!cur || rank(p) < rank(cur)) best.set(p.unit, p);
  }
  return [...best.values()];
}

export async function readUsda(dir: string): Promise<SourceFood[]> {
  const categories = new Map<string, { code: string; name: string }>();
  for await (const [id, code, description] of csvRows(join(dir, 'food_category.csv'))) {
    categories.set(id, { code, name: description });
  }
  const values = new Map<string, Partial<Record<UsdaKey, number>>>();
  for await (const [, fdcId, nutrientId, amount] of csvRows(join(dir, 'food_nutrient.csv'))) {
    const key = USDA_NUTRIENTS[Number(nutrientId) as keyof typeof USDA_NUTRIENTS];
    if (!key || amount === '') continue;
    const v = values.get(fdcId) ?? {};
    v[key] = Number(amount);
    values.set(fdcId, v);
  }
  const portions = new Map<string, Portion[]>();
  for await (const [, fdcId, , amount, , , modifier, grams] of csvRows(join(dir, 'food_portion.csv'))) {
    const p = mapUsdaPortion(modifier, Number(amount), Number(grams));
    if (p) portions.set(fdcId, [...(portions.get(fdcId) ?? []), p]);
  }
  const foods: SourceFood[] = [];
  for await (const [fdcId, , description, categoryId] of csvRows(join(dir, 'food.csv'))) {
    const cat = categories.get(categoryId);
    foods.push({
      key: `usda:${fdcId}`,
      source: 'USDA',
      ref: fdcId,
      nameEn: description,
      nameFr: null,
      group: cat?.code ?? '',
      groupName: cat?.name ?? '',
      values: usdaToEu(values.get(fdcId) ?? {}),
      portions: pickPortions(portions.get(fdcId) ?? []),
    });
  }
  return foods;
}

export function emptyNutrition(): Nutrition {
  return Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, null])) as Nutrition;
}
