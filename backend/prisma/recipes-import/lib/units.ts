/** Jednostki ze strony → jednostki Cookivo i kontrola, czy ilość naprawdę jest w tekście źródła */
import type { SourceUnit } from './ai-schema.js';

export interface CookivoAmount {
  amount: number;
  unitCode: string;
  /** Przeliczono z miar amerykańskich/imperialnych (zmiana opisana w źródle przepisu) */
  converted: boolean;
}

/** Miary metryczne → g / ml dokładnie; amerykańskie → g / ml z zaokrągleniem; cup → szklanka */
const FACTORS: Partial<Record<SourceUnit, { unit: 'g' | 'ml'; factor: number; exact: boolean }>> = {
  kg: { unit: 'g', factor: 1000, exact: true },
  dag: { unit: 'g', factor: 10, exact: true },
  mg: { unit: 'g', factor: 0.001, exact: true },
  l: { unit: 'ml', factor: 1000, exact: true },
  dl: { unit: 'ml', factor: 100, exact: true },
  cl: { unit: 'ml', factor: 10, exact: true },
  OZ: { unit: 'g', factor: 28.35, exact: false },
  LB: { unit: 'g', factor: 453.6, exact: false },
  STICK: { unit: 'g', factor: 113, exact: false },
  FL_OZ: { unit: 'ml', factor: 29.57, exact: false },
  PINT: { unit: 'ml', factor: 473, exact: false },
  QUART: { unit: 'ml', factor: 946, exact: false },
};

function roundConverted(v: number): number {
  if (v >= 100) return Math.round(v / 5) * 5;
  if (v >= 10) return Math.round(v);
  return Math.round(v * 2) / 2 || Math.round(v * 10) / 10;
}

export function toCookivo(amount: number, unit: SourceUnit): CookivoAmount {
  if (unit === 'CUP') return { amount, unitCode: 'GLASS', converted: true };
  const f = FACTORS[unit];
  if (!f) return { amount, unitCode: unit, converted: false };
  const v = amount * f.factor;
  return f.exact
    ? { amount: Math.round(v * 1000) / 1000, unitCode: f.unit, converted: false }
    : { amount: roundConverted(v), unitCode: f.unit, converted: true };
}

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '¼': 0.25,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};

const WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  dozen: 12,
  half: 0.5,
  quarter: 0.25,
  jeden: 1,
  jedna: 1,
  jedno: 1,
  jednej: 1,
  dwa: 2,
  dwie: 2,
  dwóch: 2,
  trzy: 3,
  cztery: 4,
  pięć: 5,
  sześć: 6,
  pół: 0.5,
  półtora: 1.5,
  półtorej: 1.5,
  ćwierć: 0.25,
  parę: 2,
  kilka: 3,
  couple: 2,
  few: 3,
};

/** Wszystkie liczby w tekście: całkowite, dziesiętne (też z przecinkiem), ułamki, mieszane, słowa */
export function valuesInText(text: string): number[] {
  const out: number[] = [];
  const t = text.toLowerCase();
  for (const m of t.matchAll(/(\d+)\s*[- ]?\s*([½¼¾⅓⅔⅛⅜⅝⅞])/g))
    out.push(Number(m[1]) + UNICODE_FRACTIONS[m[2]]);
  for (const m of t.matchAll(/[½¼¾⅓⅔⅛⅜⅝⅞]/g)) out.push(UNICODE_FRACTIONS[m[0]]);
  for (const m of t.matchAll(/(\d+)\s+(\d+)\s*\/\s*(\d+)/g))
    out.push(Number(m[1]) + Number(m[2]) / Number(m[3]));
  for (const m of t.matchAll(/(\d+)\s*\/\s*(\d+)/g)) out.push(Number(m[1]) / Number(m[2]));
  for (const m of t.matchAll(/\d+(?:[.,]\d+)?/g)) out.push(Number(m[0].replace(',', '.')));
  for (const m of t.matchAll(/[a-ząćęłńóśźż]+/g)) if (WORDS[m[0]] !== undefined) out.push(WORDS[m[0]]);
  // "one and a half", "półtorej" zostały wyżej; "1 and 1/2"
  for (const m of t.matchAll(/(\d+)\s+and\s+(?:a\s+)?half/g)) out.push(Number(m[1]) + 0.5);
  if (/\band a half\b/.test(t)) out.push(...out.filter(Number.isInteger).map((v) => v + 0.5));
  return out;
}

/**
 * Czy ilość z odczytu AI jest w tekście linii. 1 wolno bez liczby ("cebula", "an egg").
 * Zabezpiecza przed ilościami dopisanymi przez model.
 */
export function amountInText(amount: number, text: string): boolean {
  if (amount === 1) return true;
  return valuesInText(text).some((v) => Math.abs(v - amount) < 0.011 || Math.abs(v - amount) / amount < 0.01);
}

const WORD = /[a-ząćęłńóśźż]{4,}/g;

/**
 * Udział słów (4+ litery) fragmentu, które występują w tekście źródła - kroki i linie
 * składników muszą pochodzić ze strony (model może je tylko lekko wygładzić).
 */
export function overlap(fragment: string, sourceWords: Set<string>): number {
  const words = fragment.toLowerCase().match(WORD) ?? [];
  if (!words.length) return 1;
  return (
    words.filter((w) => sourceWords.has(w) || sourceWords.has(w.slice(0, -1)) || hasPrefix(sourceWords, w))
      .length / words.length
  );
}

function hasPrefix(words: Set<string>, w: string): boolean {
  // Odmiana: "ziemniaki" ↔ "ziemniaków", "chopped" ↔ "chop" - wspólny rdzeń 5+ liter
  if (w.length < 6) return false;
  const stem = w.slice(0, Math.max(5, w.length - 3));
  for (const s of words) if (s.startsWith(stem)) return true;
  return false;
}

export function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().match(WORD) ?? []);
}
