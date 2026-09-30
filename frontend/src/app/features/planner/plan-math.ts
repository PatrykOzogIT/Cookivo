import type { Macros, PlanMeal } from './planner.api';

/** Daty planera jako 'YYYY-MM-DD' w czasie lokalnym (bez przesunięć strefy) */
export function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, days: number): string {
  const d = parseDay(iso);
  d.setDate(d.getDate() + days);
  return isoDay(d);
}

/** Poniedziałek tygodnia, w którym jest dana data */
export function mondayOf(iso: string): string {
  const d = parseDay(iso);
  const shift = (d.getDay() + 6) % 7; // pn = 0 … nd = 6
  d.setDate(d.getDate() - shift);
  return isoDay(d);
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Poprawny poniedziałek z parametru adresu albo bieżący tydzień */
export function weekFromParam(param: string | undefined, today = isoDay(new Date())): string {
  if (param && /^\d{4}-\d{2}-\d{2}$/.test(param) && isoDay(parseDay(param)) === param) return mondayOf(param);
  return mondayOf(today);
}

/**
 * Suma kcal i makro z porcji osoby w danym dniu. Bez klucza osoby (tryb prosty) - moje porcje;
 * w trybie dokładnym - porcje z podziału (osoba nieobecna przy posiłku nic nie je).
 */
export function dayTotals(meals: PlanMeal[], personKey?: string): Macros {
  const total = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  for (const m of meals) {
    const servings =
      personKey && m.shares ? (m.shares.find((s) => s.key === personKey)?.servings ?? 0) : m.myServings;
    for (const k of ['kcal', 'protein', 'fat', 'carbs'] as const)
      total[k] += m.recipe.perServing[k] * servings;
  }
  return total;
}

export type BalanceStatus = 'empty' | 'under' | 'ok' | 'over';

/** Ocena dnia względem celu: ±10% to "w normie" */
export function balanceStatus(value: number, target: number | undefined): BalanceStatus {
  if (!target || value <= 0) return 'empty';
  const ratio = value / target;
  if (ratio < 0.9) return 'under';
  if (ratio > 1.1) return 'over';
  return 'ok';
}

/** Czytelne porcje: 1, 1,5, 0,33 → z przecinkiem w PL */
export function formatServings(n: number, lang: string): string {
  return new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'pl-PL', { maximumFractionDigits: 2 }).format(n);
}

/** "pon. 5 paź" / "Mon 5 Oct" */
export function formatDay(iso: string, lang: string, long = false): string {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'pl-PL', {
    weekday: long ? 'long' : 'short',
    day: 'numeric',
    month: long ? 'long' : 'short',
  }).format(parseDay(iso));
}
