import type { Localized, Unit } from '../ingredients/ingredients.models';

/** Opcje jednostek dla pozycji przepisu - zależą od wybranego składnika / podprzepisu. */
export interface LineUnitOption {
  code: string;
  /** Klucz tłumaczenia (g, ml, porcja) albo nazwa ze słownika */
  key?: string;
  name?: Localized;
  /** Ile gramów to 1 jednostka (null = nie wiadomo z góry, np. porcja podprzepisu) */
  grams: number | null;
}

export interface LineItem {
  kind: 'ingredient' | 'recipe';
  id: string;
  name: Localized;
  density?: number | null;
  units?: (Localized & { code: string; grams: number })[];
  servings?: number;
}

export function unitOptions(item: LineItem | null, dictionary: Unit[]): LineUnitOption[] {
  if (!item) return [{ code: 'g', key: 'units.gShort', grams: 1 }];
  if (item.kind === 'recipe') {
    return [
      { code: 'SERVING', key: 'recipes.units.serving', grams: null },
      { code: 'g', key: 'units.gShort', grams: 1 },
    ];
  }
  const options: LineUnitOption[] = [{ code: 'g', key: 'units.gShort', grams: 1 }];
  const density = item.density ?? null;
  if (density) options.push({ code: 'ml', key: 'units.mlShort', grams: density });
  for (const u of item.units ?? []) options.push({ code: u.code, name: u, grams: u.grams });
  if (density) {
    for (const u of dictionary) {
      if (u.ml && !(item.units ?? []).some((own) => own.code === u.code)) {
        options.push({ code: u.code, name: u, grams: u.ml * density });
      }
    }
  }
  return options;
}

/** Domyślna jednostka po wybraniu pozycji: porcja dla podprzepisu, pierwsza "kuchenna" dla składnika. */
export function defaultUnit(item: LineItem): string {
  if (item.kind === 'recipe') return 'SERVING';
  return item.units?.[0]?.code ?? (item.density ? 'ml' : 'g');
}

/**
 * Ilość po przeskalowaniu porcji, zaokrąglona "po kuchennemu":
 * gramy do pełnych (lub 5 g powyżej 100 g), sztuki i łyżki do ćwiartek.
 */
export function scaleAmount(amount: number, factor: number, unitCode: string): number {
  const v = amount * factor;
  if (unitCode === 'g' || unitCode === 'ml') {
    if (v >= 100) return Math.round(v / 5) * 5;
    if (v >= 10) return Math.round(v);
    return Math.round(v * 10) / 10;
  }
  return Math.max(0.25, Math.round(v * 4) / 4);
}

/** 0,25 → ¼, 1,5 → 1½ - czytelniej przy sztukach i łyżkach */
export function prettyFraction(v: number, lang: string): string {
  const whole = Math.floor(v);
  const frac = Math.round((v - whole) * 4) / 4;
  const glyph: Record<number, string> = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
  if (frac === 0 || frac === 1) return String(frac === 1 ? whole + 1 : whole);
  if (glyph[frac]) return whole ? `${whole}${glyph[frac]}` : glyph[frac];
  return new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'pl-PL', { maximumFractionDigits: 2 }).format(v);
}
