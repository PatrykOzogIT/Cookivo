/**
 * Składanie przepisów z odczytu AI: kontrola jakości, jednostki, dopasowanie składników,
 * duble i limity. Czysta logika (testy bez bazy i bez sieci).
 */
import { isConfidentMatch, unitAllowed } from '../../../src/ai/ingredient-names.js';
import { normalizeSearch } from '../../../src/common/text.js';
import type { StructuredLine, StructuredRecipe } from './ai-schema.js';
import { LICENSE, LICENSE_URL, type RecipePhoto, type RecipeRecord } from './record.js';
import { historyUrl, pageUrl, type RecipeStatus, type Wiki } from './types.js';
import { toCookivo } from './units.js';

export interface CatalogIngredient {
  namePl: string;
  nameEn: string | null;
  category: string;
  density: number | null;
  units: { code: string; grams: number }[];
}

export interface Ingredients {
  byName: Map<string, CatalogIngredient>;
  all: CatalogIngredient[];
  unitMl: Record<string, number | null>;
}

/** Szacunki wag miar kuchennych (units.ts) - klucz: nazwa składnika */
export type UnitEstimates = Record<string, { grams: Partial<Record<string, number>>; notFit: string[] }>;

/**
 * Składniki uzupełnione o szacunki miar (w pamięci): tylko miary, których składnik nie zna
 * i których nie da się policzyć z gęstości. Importer zapisze je w bazie jako szacunek AI.
 */
export function withEstimates(
  list: CatalogIngredient[],
  estimates: UnitEstimates,
  unitMl: Record<string, number | null>,
): CatalogIngredient[] {
  return list.map((i) => {
    const e = estimates[normalizeSearch(i.namePl)];
    if (!e) return i;
    const extra = Object.entries(e.grams)
      .filter(([code]) => !i.units.some((u) => u.code === code) && !(i.density && unitMl[code]))
      .map(([code, grams]) => ({ code, grams: grams! }));
    return extra.length ? { ...i, units: [...i.units, ...extra] } : i;
  });
}

export function ingredientIndex(
  list: CatalogIngredient[],
  unitMl: Record<string, number | null>,
): Ingredients {
  return { byName: new Map(list.map((i) => [normalizeSearch(i.namePl), i])), all: list, unitMl };
}

/** Składnik z bazy: nazwa wybrana przez AI z listy → ta sama nazwa → pewne dopasowanie nazwy */
export function resolveIngredient(line: StructuredLine, ing: Ingredients): CatalogIngredient | null {
  for (const name of [line.catalogName, line.name]) {
    const hit = name ? ing.byName.get(normalizeSearch(name)) : undefined;
    if (hit) return hit;
  }
  const confident = ing.all.filter((c) => isConfidentMatch(line.name, c));
  return confident.sort((a, b) => a.namePl.length - b.namePl.length)[0] ?? null;
}

export interface LineResult {
  line?: RecipeRecord['ingredients'][number];
  missing?: string;
  missingUnit?: string;
  /** Brakująca waga miary składnika (do szacunku: units.ts) */
  unitNeed?: { ingredient: string; unitCode: string };
  reject?: string;
  converted?: boolean;
  assumed?: boolean;
  /** Dodatek do podania bez ilości - przenosimy do opisu zamiast odrzucać przepis */
  servedWith?: string;
}

const UNIT_LABEL: Record<string, string> = {
  PIECE: 'sztuka',
  SLICE: 'plaster',
  CLOVE: 'ząbek',
  BUNCH: 'pęczek',
  HANDFUL: 'garść',
  PINCH: 'szczypta',
  CAN: 'puszka',
  PACKAGE: 'opakowanie',
  TEASPOON: 'łyżeczka',
  TABLESPOON: 'łyżka',
  GLASS: 'szklanka',
  ml: 'ml (gęstość)',
};

const SERVING =
  /^\s*(do podania|podawać z|do dekoracji|to serve|for serving|serve with|for garnish)\b\s*:?\s*/i;
const servedText = (text: string) => text.replace(SERVING, '').trim();

/** Kategorie, którym bez ilości dajemy umowną łyżkę (smażenie, natłuszczenie, oprószenie, obtoczenie) */
const SPOON_CATEGORIES = new Set(['FATS', 'BAKING', 'SWEETS', 'NUTS_SEEDS']);

/**
 * Pozycja przepisu. Bez ilości: przyprawy "do smaku" = szczypta, tłuszcz do smażenia, mąka do obtoczenia,
 * kakao do oprószenia = łyżka (umowna ilość opisana w źródle przepisu); inne dodatki "do podania" bez
 * ilości trafiają do opisu. Brak ilości przy zwykłym składniku odrzuca przepis.
 */
export function resolveLine(l: StructuredLine, ing: Ingredients, group: string | null): LineResult {
  const found = resolveIngredient(l, ing);
  const noAmount = l.amount === null || l.amount <= 0;
  // "do podania: …" bez ilości - nawet gdy składnika nie ma w bazie
  if (noAmount && l.toTaste && SERVING.test(l.text)) return { servedWith: servedText(l.text) };
  if (!found) return { missing: l.name.trim().toLowerCase() };
  const allowed = (unit: string) =>
    unitAllowed(unit, { density: found.density, units: found.units }, ing.unitMl);
  const base = { ingredient: found.namePl, groupName: group, note: l.note?.slice(0, 120) || null };

  if (noAmount) {
    if (!l.toTaste) return { reject: 'MISSING_AMOUNT' };
    if (found.category === 'HERBS_SPICES' || found.category === 'SAUCES') {
      return allowed('PINCH')
        ? { line: { ...base, amount: 1, unitCode: 'PINCH' }, assumed: true }
        : { line: { ...base, amount: 1, unitCode: 'g' }, assumed: true };
    }
    if (SPOON_CATEGORIES.has(found.category)) {
      return allowed('TABLESPOON')
        ? { line: { ...base, amount: 1, unitCode: 'TABLESPOON' }, assumed: true }
        : { line: { ...base, amount: 10, unitCode: 'g' }, assumed: true };
    }
    return { servedWith: servedText(l.text) };
  }

  const c = toCookivo(l.amount!, l.unit ?? 'PIECE');
  if (!allowed(c.unitCode)) {
    return {
      missingUnit: `${found.namePl} (${UNIT_LABEL[c.unitCode] ?? c.unitCode})`,
      unitNeed: { ingredient: found.namePl, unitCode: c.unitCode },
    };
  }
  return { line: { ...base, amount: c.amount, unitCode: c.unitCode }, converted: c.converted };
}

export interface Candidate {
  key: string;
  pageKey: string;
  wiki: Wiki;
  pageTitle: string;
  revId: number;
  views: number | null;
  /** Miejsce przepisu na stronie (0 = pierwszy - dostaje zdjęcie strony) */
  index: number;
  recipe: StructuredRecipe;
  checks: string[];
  images: string[];
}

export interface Evaluated {
  c: Candidate;
  status: RecipeStatus;
  reason?: string;
  missing?: string[];
  /** Brakujące wagi miar (składnik + miara) - wejście szacunku hurtowego */
  unitNeeds?: { ingredient: string; unitCode: string }[];
  /** Przepis po kontroli: bez dodatków do podania (są w opisie) */
  recipe: StructuredRecipe;
  lines: RecipeRecord['ingredients'];
  changes: string[];
}

/** Kontrola jakości i dopasowanie składników jednego przepisu */
export function evaluate(c: Candidate, ing: Ingredients): Evaluated {
  const reasons: string[] = [...c.recipe.problems];
  const lines: RecipeRecord['ingredients'] = [];
  const kept: StructuredRecipe['ingredients'] = [];
  const servedWith: string[] = [];
  const missing = new Set<string>();
  const missingUnits = new Set<string>();
  const unitNeeds: { ingredient: string; unitCode: string }[] = [];
  let converted = false;
  let assumed = false;
  for (const l of c.recipe.ingredients) {
    const res = resolveLine(l, ing, l.group?.slice(0, 80) || null);
    if (res.servedWith) {
      servedWith.push(res.servedWith);
      continue;
    }
    kept.push(l);
    if (res.reject) reasons.push(res.reject);
    if (res.missing) missing.add(res.missing);
    if (res.missingUnit) missingUnits.add(res.missingUnit);
    if (res.unitNeed) unitNeeds.push(res.unitNeed);
    if (res.line) lines.push(res.line);
    converted ||= !!res.converted;
    assumed ||= !!res.assumed;
  }
  const label = c.wiki === 'pl' ? 'Do podania' : 'Serve with';
  const r: StructuredRecipe = {
    ...c.recipe,
    ingredients: kept,
    description: servedWith.length
      ? [c.recipe.description, `${label}: ${servedWith.join('; ')}.`].filter(Boolean).join('\n\n')
      : c.recipe.description,
  };
  if (r.ingredients.length < 2) reasons.push('TOO_FEW_INGREDIENTS');
  if (!r.steps.length) reasons.push('NO_STEPS');
  if (r.servings < 1 || r.servings > 50) reasons.push('SERVINGS');
  if (!r.title.trim() || r.title.length > 150) reasons.push('TITLE');
  if (r.steps.some((s) => s.text.length > 2000)) reasons.push('STEP_TOO_LONG');
  if (r.ingredients.length > 60 || r.steps.length > 60) reasons.push('TOO_LONG');
  // Odczyt niezgodny z tekstem strony (ilość albo krok spoza strony) - nie ryzykujemy
  const notInSource = [...new Set(c.checks.map((f) => f.split(':')[0]))];
  reasons.push(...notInSource);

  const changes = [
    'RESTRUCTURED',
    ...(converted ? ['UNITS_CONVERTED'] : []),
    ...(assumed ? ['TO_TASTE'] : []),
    ...(servedWith.length ? ['SERVED_WITH'] : []),
  ];
  if (reasons.length)
    return { c, recipe: r, status: 'REJECTED', reason: [...new Set(reasons)].join(','), lines, changes };
  if (missing.size)
    return { c, recipe: r, status: 'WAITING_INGREDIENT', missing: [...missing], lines, changes };
  if (missingUnits.size) {
    return { c, recipe: r, status: 'WAITING_UNIT', missing: [...missingUnits], unitNeeds, lines, changes };
  }
  return { c, recipe: r, status: 'READY', lines, changes };
}

/** Podobieństwo zestawów składników (Jaccard) */
export function jaccard(a: Set<string>, b: Set<string>): number {
  let common = 0;
  for (const x of a) if (b.has(x)) common++;
  return common / (a.size + b.size - common || 1);
}

/**
 * Kolejność ważności: przepisy z poprzedniego pliku importu, polskie, potem wg wyświetleń, potem klucz
 * (przy dublach zostaje ważniejszy)
 */
export function candidatePriority(a: Candidate, b: Candidate, previous: Set<string> = new Set()): number {
  const pa = previous.has(a.key);
  if (pa !== previous.has(b.key)) return pa ? -1 : 1;
  if (a.wiki !== b.wiki) return a.wiki === 'pl' ? -1 : 1;
  return (b.views ?? -1) - (a.views ?? -1) || a.key.localeCompare(b.key);
}

export const DATASET_VERSION = 'wikibooks-2026-10';

export function toRecord(
  e: Evaluated,
  pl: { title: string; description: string | null; steps: string[]; groups: string[]; notes: string[] },
  en: { title: string; description: string | null; steps: string[]; groups: string[]; notes: string[] },
  photo: RecipePhoto | null,
): RecipeRecord {
  const r = e.recipe;
  // Grupy i dopiski w tej samej kolejności co pozycje
  const groupIdx = (g: string | null) => (g ? groupNames(r).indexOf(g.slice(0, 80)) : -1);
  const lineTexts = (v: typeof pl) =>
    r.ingredients.map((l, i) => ({
      groupName: groupIdx(l.group) >= 0 ? v.groups[groupIdx(l.group)].slice(0, 80) || null : null,
      note: v.notes[i]?.slice(0, 120) || null,
    }));
  const plLines = lineTexts(pl);
  return {
    key: e.c.key,
    wiki: e.c.wiki,
    revId: e.c.revId,
    course: r.course,
    views: e.c.views,
    title: pl.title.slice(0, 150),
    description: pl.description?.slice(0, 2000) || null,
    servings: r.servings,
    servingsEstimated: r.servingsEstimated,
    prepMinutes: r.prepMinutes && r.prepMinutes > 0 ? r.prepMinutes : null,
    cookMinutes: r.cookMinutes && r.cookMinutes > 0 ? r.cookMinutes : null,
    difficulty: r.difficulty,
    mealTypes: [...new Set(r.mealTypes)],
    ingredients: e.lines.map((l, i) => ({ ...l, groupName: plLines[i].groupName, note: plLines[i].note })),
    steps: r.steps.map((s, i) => ({
      text: pl.steps[i].slice(0, 2000),
      timerMinutes: s.timerMinutes && s.timerMinutes > 0 ? s.timerMinutes : null,
    })),
    translation: {
      locale: 'en',
      title: en.title.slice(0, 150),
      description: en.description?.slice(0, 2000) || null,
      steps: en.steps.map((s) => s.slice(0, 2000)),
      lines: lineTexts(en),
    },
    source: {
      sourceName: 'Wikibooks',
      sourceLocale: e.c.wiki,
      sourceTitle: e.c.pageTitle,
      url: pageUrl(e.c.wiki, e.c.pageTitle),
      historyUrl: historyUrl(e.c.wiki, e.c.pageTitle),
      license: LICENSE,
      licenseUrl: LICENSE_URL,
      changes: e.changes,
      datasetVersion: DATASET_VERSION,
    },
    photo,
  };
}

/** Różne nazwy grup składników przepisu w kolejności (wejście tłumaczenia) */
export function groupNames(r: StructuredRecipe): string[] {
  return [...new Set(r.ingredients.flatMap((l) => (l.group ? [l.group.slice(0, 80)] : [])))];
}

/** Treść w języku strony - do tłumaczenia i jako jedna z wersji językowych */
export function sourceTexts(r: StructuredRecipe) {
  return {
    title: r.title.trim(),
    description: r.description?.trim() || null,
    groups: groupNames(r),
    notes: r.ingredients.map((l) => l.note?.trim() ?? ''),
    steps: r.steps.map((s) => s.text.trim()),
  };
}
