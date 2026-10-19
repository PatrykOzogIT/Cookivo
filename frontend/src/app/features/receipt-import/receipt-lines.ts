import { parseDecimal } from '../../core/i18n/format.pipes';
import type {
  MatchStatus,
  ReceiptCommitLine,
  ReceiptDraftLine,
  ReceiptIngredient,
} from './receipt-import.api';

/** Pozycja paragonu w edycji - liczby jako tekst z pól (polski przecinek) */
export interface EditLine {
  key: number;
  text: string;
  name: string;
  status: MatchStatus;
  ingredient: ReceiptIngredient | null;
  suggestions: ReceiptIngredient[];
  packages: string;
  packageAmount: string;
  packageUnitCode: string | null;
  price: string;
  toPantry: boolean;
  toPrices: boolean;
  uncertain: boolean;
  warnings: string[];
}

/** Co jest nie tak z pozycją - kody `receiptImport.problem.<KOD>` */
export type LineProblem = 'NO_INGREDIENT' | 'PACKAGES' | 'PACKAGE' | 'PRICE';

export function decimalText(value: number | null, lang: string): string {
  if (value === null) return '';
  return lang === 'en' ? String(value) : String(value).replace('.', ',');
}

export function fromDraft(line: ReceiptDraftLine, lang: string): EditLine {
  return {
    key: line.key,
    text: line.text,
    name: line.name,
    status: line.status,
    ingredient: line.ingredient,
    suggestions: line.suggestions,
    packages: decimalText(line.packages, lang),
    packageAmount: decimalText(line.packageAmount, lang),
    packageUnitCode: line.packageUnitCode,
    price: line.priceCents === null ? '' : decimalText(line.priceCents / 100, lang),
    toPantry: true,
    toPrices: true,
    uncertain: line.uncertain,
    warnings: line.warnings,
  };
}

const positive = (text: string): number | null => {
  const n = parseDecimal(text);
  return n !== null && !Number.isNaN(n) && n > 0 ? n : null;
};

/**
 * Braki pozycji przy wybranych celach. Pozycja bez celu (ani lodówka, ani cennik)
 * niczego nie wymaga - zostanie pominięta.
 */
export function lineProblems(line: EditLine, pantry: boolean, prices: boolean): LineProblem[] {
  const toPantry = pantry && line.toPantry;
  const toPrices = prices && line.toPrices;
  if (!toPantry && !toPrices) return [];
  const problems: LineProblem[] = [];
  if (!line.ingredient) problems.push('NO_INGREDIENT');
  if (positive(line.packages) === null) problems.push('PACKAGES');
  if (positive(line.packageAmount) === null || !line.packageUnitCode) problems.push('PACKAGE');
  const price = parseDecimal(line.price);
  if (toPrices && (price === null || Number.isNaN(price) || price <= 0)) problems.push('PRICE');
  return problems;
}

/** Wartość pozycji w groszach: opakowania × cena regularna */
export function lineTotalCents(line: EditLine): number | null {
  const packages = positive(line.packages);
  const price = positive(line.price);
  return packages !== null && price !== null ? Math.round(packages * Math.round(price * 100)) : null;
}

export interface ReceiptSummary {
  lines: number;
  pantry: number;
  prices: number;
  attention: number;
  totalCents: number;
}

export function summarize(lines: EditLine[], pantry: boolean, prices: boolean): ReceiptSummary {
  return {
    lines: lines.length,
    pantry: pantry ? lines.filter((l) => l.toPantry).length : 0,
    prices: prices ? lines.filter((l) => l.toPrices).length : 0,
    attention: lines.filter((l) => lineProblems(l, pantry, prices).length || l.warnings.length || l.uncertain)
      .length,
    totalCents: lines.reduce((sum, l) => sum + (lineTotalCents(l) ?? 0), 0),
  };
}

/** Pozycja do zatwierdzenia (wywołać tylko dla pozycji bez braków) */
export function toCommitLine(line: EditLine, pantry: boolean, prices: boolean): ReceiptCommitLine {
  return {
    ingredientId: line.ingredient!.id,
    toPantry: pantry && line.toPantry,
    toPrices: prices && line.toPrices,
    packages: positive(line.packages)!,
    packageAmount: positive(line.packageAmount)!,
    packageUnitCode: line.packageUnitCode!,
    price: prices && line.toPrices ? positive(line.price) : null,
  };
}
