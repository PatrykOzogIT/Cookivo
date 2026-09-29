import { Pipe, type PipeTransform } from '@angular/core';

interface Localized {
  namePl: string;
  nameEn?: string | null;
}

/** Nazwa w bieżącym języku: `{{ item | localized: lang() }}` (EN → fallback do PL). */
@Pipe({ name: 'localized' })
export class LocalizedPipe implements PipeTransform {
  transform(value: Localized | null | undefined, lang: string): string {
    if (!value) return '';
    return lang === 'en' && value.nameEn ? value.nameEn : value.namePl;
  }
}

const formatters = new Map<string, Intl.NumberFormat>();

/** Liczba w formacie języka (PL: "4,7", EN: "4.7"); null → "—" (brak danych). */
export function formatNumber(value: number | null | undefined, lang: string, maxFraction = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const key = `${lang}:${maxFraction}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'pl-PL', { maximumFractionDigits: maxFraction });
    formatters.set(key, fmt);
  }
  return fmt.format(value);
}

@Pipe({ name: 'num' })
export class NumberPipe implements PipeTransform {
  transform(value: number | null | undefined, lang: string, maxFraction = 1): string {
    return formatNumber(value, lang, maxFraction);
  }
}

/** "4,7" albo "4.7" → 4.7; puste → null; bzdury → NaN */
export function parseDecimal(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  const text = String(input).trim().replace(/\s/g, '').replace(',', '.');
  if (!text) return null;
  return /^-?\d*\.?\d+$/.test(text) ? Number(text) : Number.NaN;
}
