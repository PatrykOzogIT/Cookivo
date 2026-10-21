import type { PrepStep } from './assistant.api';

/** Klucz kroku (odhaczanie): "A2" */
export const stepKey = (s: Pick<PrepStep, 'dish' | 'index'>): string => `${s.dish}${s.index}`;

/** Godzina startu "HH:MM" + minuty → "HH:MM" (przez północ dalej liczymy od 00:00) */
export function clockAt(start: string, offset: number): string {
  const [h, m] = start.split(':').map(Number);
  const total = (((h * 60 + m + offset) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** "2 h 20 min" / "45 min" */
export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export interface Background {
  dish: string;
  text: string | null;
  until: number;
}

/**
 * Co dzieje się w tle, gdy kończysz ten krok: czas w tle tego i wcześniejszych kroków,
 * który jeszcze trwa (np. "A: piecze się do 11:20").
 */
export function backgroundsAfter(steps: PrepStep[], row: PrepStep): Background[] {
  const at = row.start + row.minutes;
  return steps
    .filter((s) => s.wait && s.start + s.minutes <= at && at < s.start + s.minutes + s.wait)
    .map((s) => ({ dish: s.dish, text: s.background, until: s.start + s.minutes + s.wait }));
}
