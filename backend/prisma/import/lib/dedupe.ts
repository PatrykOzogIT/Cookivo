import { features, type Features } from './features.js';
import { NUTRIENT_KEYS, type Nutrition, type Portion, type SourceFood } from './types.js';

/** Kandydat do importu: jeden produkt po scaleniu duplikatów (w źródle i między źródłami) */
export interface Candidate {
  importKey: string;
  source: SourceFood['source'];
  ref: string;
  nameEn: string;
  nameFr: string | null;
  group: string;
  groupName: string;
  values: Nutrition;
  portions: Portion[];
  features: Features;
  strictKey: string;
  /** Scalone duplikaty (inne pozycje tego samego produktu) */
  merged: { key: string; nameEn: string; reason: 'SAME_SOURCE' | 'OTHER_SOURCE' }[];
  /** Pola uzupełnione z drugiego źródła (tylko brakujące, nigdy nadpisane) */
  filledFrom: { field: string; key: string }[];
}

/** Ścisły klucz: produkt bazowy + cechy + słowa opisu (bez szumu) - identyczny = ten sam produkt */
export function strictKey(f: Features): string {
  return [f.base, ...f.tags, '/', ...[...new Set(f.detail)].sort()].join('|');
}

/** Mniej słów = bardziej ogólna pozycja; przy remisie kompletniejsze wartości */
function better(a: SourceFood, b: SourceFood): SourceFood {
  const filled = (s: SourceFood) => NUTRIENT_KEYS.filter((k) => s.values[k] !== null).length;
  const words = (s: SourceFood) => s.nameEn.split(/[\s,]+/).length;
  // Warianty "z solą" / "bez soli" / niskosodowe scalamy - zostaje zwykła wersja produktu
  const salty = (s: SourceFood) =>
    Number(/\b(with salt|without salt|no salt|salt added|unsalted|sodium)\b/i.test(s.nameEn));
  if (salty(a) !== salty(b)) return salty(a) < salty(b) ? a : b;
  if (filled(a) !== filled(b)) return filled(a) > filled(b) ? a : b;
  if (words(a) !== words(b)) return words(a) < words(b) ? a : b;
  return a.key < b.key ? a : b;
}

function toCandidate(food: SourceFood, f: Features, key: string): Candidate {
  return {
    importKey: food.key,
    source: food.source,
    ref: food.ref,
    nameEn: food.nameEn,
    nameFr: food.nameFr,
    group: food.group,
    groupName: food.groupName,
    values: { ...food.values },
    portions: [...food.portions],
    features: f,
    strictKey: key,
    merged: [],
    filledFrom: [],
  };
}

/**
 * Scalanie: najpierw duplikaty w obrębie źródła (ten sam ścisły klucz - zostaje ogólniejsza
 * i kompletniejsza pozycja), potem między źródłami - Ciqual ma pierwszeństwo, USDA uzupełnia
 * tylko brakujące wartości opcjonalne i jednostki kuchenne.
 */
export function dedupe(ciqual: SourceFood[], usda: SourceFood[]): Candidate[] {
  const pick = (foods: SourceFood[]) => {
    const groups = new Map<string, { best: SourceFood; f: Features; all: SourceFood[] }>();
    for (const food of foods) {
      const f = features(food.nameEn);
      const key = strictKey(f);
      const g = groups.get(key);
      if (!g) groups.set(key, { best: food, f, all: [food] });
      else {
        g.all.push(food);
        const best = better(g.best, food);
        if (best !== g.best) Object.assign(g, { best, f: features(best.nameEn) });
      }
    }
    return [...groups.entries()].map(([key, g]) => {
      const c = toCandidate(g.best, g.f, key);
      c.merged = g.all
        .filter((x) => x !== g.best)
        .map((x) => ({ key: x.key, nameEn: x.nameEn, reason: 'SAME_SOURCE' as const }));
      return c;
    });
  };
  const fromCiqual = pick(ciqual);
  const byKey = new Map(fromCiqual.map((c) => [c.strictKey, c]));
  const result = [...fromCiqual];
  for (const u of pick(usda)) {
    const eu = byKey.get(u.strictKey);
    if (!eu) {
      result.push(u);
      continue;
    }
    eu.merged.push({ key: u.importKey, nameEn: u.nameEn, reason: 'OTHER_SOURCE' }, ...u.merged);
    // Uzupełnienie tylko braków - wiarygodnych wartości europejskich nie nadpisujemy
    for (const k of NUTRIENT_KEYS) {
      if (eu.values[k] === null && u.values[k] !== null) {
        eu.values[k] = u.values[k];
        eu.filledFrom.push({ field: k, key: u.importKey });
      }
    }
    for (const p of u.portions) {
      if (!eu.portions.some((x) => x.unit === p.unit)) {
        eu.portions.push(p);
        eu.filledFrom.push({ field: `unit:${p.unit}`, key: u.importKey });
      }
    }
  }
  return result;
}
