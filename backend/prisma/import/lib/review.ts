import { ALLERGENS, CATEGORIES } from '../../seed/reference-data.js';
import { cleanName } from './build.js';
import type { ImportRecord } from './record.js';
import { csv } from './report.js';

/*
 * Ręczna weryfikacja rekordów PENDING w Excelu: eksport do CSV (kolumna "OK" + pola do poprawy),
 * potem wczytanie decyzji do review-decisions.json. Build stosuje decyzje przy każdej przebudowie,
 * więc nie giną. Bez panelu admina.
 */

export const REVIEW_HEADER = [
  'OK',
  'klucz',
  'nazwa_pl',
  'nazwa_en',
  'kategoria',
  'alergeny',
  'waga_sztuki_g',
  'powody',
  'kcal',
  'bialko',
  'tluszcz',
  'weglowodany',
  'zrodlo',
];

/** Decyzja dla jednego rekordu (zatwierdzony z ewentualnymi poprawkami) */
export interface Decision {
  namePl: string;
  nameEn: string | null;
  categoryCode: string;
  allergens: string[];
  pieceGrams: number | null;
  /** Alergeny typowe dla rodzaju produktu (recenzja AI) - karta pokazuje "sprawdź etykietę" */
  allergensTypical?: boolean;
}

const REASONS: Record<string, string> = {
  ZMIENNY_SKLAD: 'skład zależy od producenta',
  KATEGORIA_ZLOZONA: 'wyrób złożony',
  ALERGENY_TYLKO_AI: 'alergen tylko od AI',
  ALERGENY_TYLKO_REGULA: 'alergen z nazwy, AI go nie podało',
  PODOBNY_ISTNIEJACY: 'podobny do istniejącego',
  JEDNOSTKA_SZACUNEK_AI: 'waga sztuki szacowana przez AI',
  KATEGORIA_NIEZNANA: 'kategoria spoza listy',
};

const norm = (s: string) => s.trim().toLowerCase();
const allergenName = new Map<string, string>(ALLERGENS.map((a) => [a.code, a.pl]));
const allergenCode = new Map<string, string>(ALLERGENS.map((a) => [norm(a.pl), a.code]));
const categoryName = new Map<string, string>(CATEGORIES.map((c) => [c.code, c.pl]));
const categoryCode = new Map<string, string>(CATEGORIES.map((c) => [norm(c.pl), c.code]));

export function reasonText(code: string): string {
  const i = code.indexOf(':');
  const key = i < 0 ? code : code.slice(0, i);
  const detail = i < 0 ? '' : code.slice(i + 1);
  const base = REASONS[key] ?? key;
  if (!detail) return base;
  if (key.startsWith('KATEGORIA')) return `${base}: ${categoryName.get(detail) ?? detail}`;
  if (key.startsWith('ALERGENY')) {
    return `${base}: ${detail
      .split(',')
      .map((c) => allergenName.get(c) ?? c)
      .join(', ')}`;
  }
  return `${base}: ${detail}`;
}

export function exportReview(records: ImportRecord[]): string {
  const rows = records
    .filter((r) => r.status === 'PENDING')
    .map((r) => [
      '',
      r.importKey,
      r.namePl,
      r.nameEn ?? '',
      categoryName.get(r.categoryCode) ?? r.categoryCode,
      r.allergens.map((a) => allergenName.get(a) ?? a).join(', '),
      r.units.find((u) => u.code === 'PIECE')?.grams ?? '',
      r.review.map(reasonText).join(' | '),
      ...[r.kcal, r.protein, r.fat, r.carbs].map((v) => String(v).replace('.', ',')),
      r.source === 'CIQUAL' ? `Ciqual ${r.sourceRef}` : `USDA ${r.sourceRef}`,
    ]);
  return csv(REVIEW_HEADER, rows);
}

/** Wiersz CSV z cudzysłowami ("" = cudzysłów) i wybranym separatorem */
export function splitCsv(line: string, sep: string): string[] {
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
    else if (c === sep) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export interface ReviewResult {
  decisions: Record<string, Decision>;
  approved: number;
  skipped: number;
  errors: string[];
}

/**
 * CSV z Excela → decyzje. "tak"/"ok"/"x" w kolumnie OK = zatwierdzony z poprawkami nazwy,
 * kategorii, alergenów i wagi sztuki; puste = zostaje poza importem.
 * Separator rozpoznajemy po nagłówku (polski Excel zapisuje ";").
 */
export function readReview(records: ImportRecord[], content: string): ReviewResult {
  const lines = content
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  const sep = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
  const header = splitCsv(lines[0], sep).map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const byKey = new Map(records.map((r) => [r.importKey, r]));
  const result: ReviewResult = { decisions: {}, approved: 0, skipped: 0, errors: [] };
  for (const line of lines.slice(1)) {
    const cells = splitCsv(line, sep);
    const get = (name: string) => (cells[col(name)] ?? '').trim();
    const key = get('klucz');
    if (!byKey.has(key)) {
      result.errors.push(`Nieznany klucz: ${key}`);
      continue;
    }
    if (!/^(tak|ok|x|t|1|yes|y)$/i.test(get('OK'))) {
      result.skipped++;
      continue;
    }
    const cat = get('kategoria');
    const category = categoryCode.get(norm(cat)) ?? (categoryName.has(cat) ? cat : null);
    if (!category) {
      result.errors.push(`${key}: nieznana kategoria "${cat}"`);
      continue;
    }
    const names = get('alergeny')
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const allergens = names.map((n) => allergenCode.get(norm(n)) ?? (allergenName.has(n) ? n : null));
    if (allergens.some((a) => !a)) {
      result.errors.push(`${key}: nieznany alergen w "${get('alergeny')}"`);
      continue;
    }
    const namePl = cleanName(get('nazwa_pl'));
    if (namePl.length < 2 || namePl.length > 120) {
      result.errors.push(`${key}: niepoprawna nazwa "${get('nazwa_pl')}"`);
      continue;
    }
    const piece = Number(get('waga_sztuki_g').replace(',', '.'));
    result.decisions[key] = {
      namePl,
      nameEn: get('nazwa_en') ? cleanName(get('nazwa_en')).slice(0, 120) : null,
      categoryCode: category,
      allergens: [...new Set(allergens as string[])].sort(),
      pieceGrams: piece > 0 && piece <= 5000 ? piece : null,
    };
    result.approved++;
  }
  return result;
}

/** Ręczne decyzje → rekordy (zatwierdzone; alergeny i waga sztuki sprawdzone przez człowieka) */
export function applyDecisions(records: ImportRecord[], decisions: Record<string, Decision>): number {
  let applied = 0;
  for (const r of records) {
    const d = decisions[r.importKey];
    if (!d) continue;
    r.namePl = d.namePl;
    r.nameEn = d.nameEn;
    r.categoryCode = d.categoryCode;
    r.allergens = d.allergens;
    r.allergenBasis = 'RULE';
    r.units = r.units.filter((u) => u.code !== 'PIECE');
    if (d.pieceGrams) r.units.push({ code: 'PIECE', grams: d.pieceGrams, basis: 'SOURCE' });
    r.status = 'APPROVED';
    r.review = [d.allergensTypical ? 'ZWERYFIKOWANY_AI' : 'ZWERYFIKOWANY_RECZNIE'];
    r.allergensTypical = d.allergensTypical ?? false;
    applied++;
  }
  return applied;
}
