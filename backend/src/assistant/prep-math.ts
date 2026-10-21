/**
 * Harmonogram gotowania (meal prep): kolejność kroków proponuje AI, a godziny liczymy tu.
 * Zasady: robisz rękami jedną rzecz naraz; następny krok dania zaczyna się dopiero, gdy skończy się
 * czas "w tle" poprzedniego (pieczenie, duszenie); kolejność kroków w daniu zawsze jak w przepisie.
 */

export type Equipment = 'OVEN' | 'HOB' | 'NONE';

export interface PrepDish {
  /** Litera dania (A, B, C…) */
  letter: string;
  steps: { text: string; timerMinutes: number | null }[];
}

/** Krok z odpowiedzi modelu (kod "A2" = drugi krok dania A) */
export interface ProposedStep {
  step: string;
  minutes: number;
  waitMinutes: number;
  background: string | null;
  equipment: Equipment;
}

export interface ScheduledStep {
  dish: string;
  /** Numer kroku w przepisie (od 1) */
  index: number;
  text: string;
  timerMinutes: number | null;
  /** Minuty od startu */
  start: number;
  minutes: number;
  /** Czas w tle po kroku (piekarnik, garnek) */
  wait: number;
  background: string | null;
  equipment: Equipment;
  /** Czas oszacowany przez model (krok bez minutnika) */
  estimated: boolean;
}

export interface Schedule {
  steps: ScheduledStep[];
  /** Koniec wszystkiego (minuty od startu) */
  end: number;
  /** Czas pracy rękami */
  handsOn: number;
  /** Okna pracy piekarnika (scalone) */
  oven: { from: number; to: number }[];
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n || 0)));

/**
 * Naprawia kolejność od modelu: nieznane i powtórzone kody wypadają, kroki dania trafiają na
 * "miejsca" tego dania w kolejności z przepisu, a pominięte - na koniec.
 */
export function orderSteps(
  dishes: PrepDish[],
  proposed: ProposedStep[],
): { dish: string; index: number; p: ProposedStep | null }[] {
  const known = new Map(dishes.map((d) => [d.letter, d.steps.length]));
  const seen = new Set<string>();
  const slots: { dish: string; code: string; p: ProposedStep }[] = [];
  for (const p of proposed) {
    const m = /^([A-Z])(\d+)$/.exec(p.step.trim().toUpperCase());
    if (!m) continue;
    const [, dish, n] = m;
    const count = known.get(dish);
    const code = `${dish}${Number(n)}`;
    if (!count || Number(n) < 1 || Number(n) > count || seen.has(code)) continue;
    seen.add(code);
    slots.push({ dish, code, p });
  }
  // Miejsca dania wypełniamy jego krokami po kolei (parametry czasu idą za numerem kroku)
  const byCode = new Map(slots.map((s) => [s.code, s.p]));
  const next = new Map(dishes.map((d) => [d.letter, 1]));
  const out: { dish: string; index: number; p: ProposedStep | null }[] = slots.map((s) => {
    const index = next.get(s.dish)!;
    next.set(s.dish, index + 1);
    return { dish: s.dish, index, p: byCode.get(`${s.dish}${index}`) ?? null };
  });
  for (const d of dishes) {
    for (let i = next.get(d.letter)!; i <= d.steps.length; i++)
      out.push({ dish: d.letter, index: i, p: null });
  }
  return out;
}

export function buildSchedule(dishes: PrepDish[], proposed: ProposedStep[]): Schedule {
  const byLetter = new Map(dishes.map((d) => [d.letter, d]));
  const readyAt = new Map<string, number>();
  let cursor = 0;
  let handsOn = 0;
  const steps: ScheduledStep[] = [];
  for (const o of orderSteps(dishes, proposed)) {
    const src = byLetter.get(o.dish)!.steps[o.index - 1];
    let minutes = clamp(o.p?.minutes ?? 10, 1, 240);
    let wait = clamp(o.p?.waitMinutes ?? 0, 0, 480);
    // Minutnik z przepisu jest wiążący: krok trwa co najmniej tyle (ręce + tło)
    if (src.timerMinutes && minutes + wait < src.timerMinutes) {
      if (wait > 0 || (o.p?.background ?? null)) wait = src.timerMinutes - minutes;
      else minutes = src.timerMinutes;
    }
    const start = Math.max(cursor, readyAt.get(o.dish) ?? 0);
    cursor = start + minutes;
    handsOn += minutes;
    readyAt.set(o.dish, cursor + wait);
    steps.push({
      dish: o.dish,
      index: o.index,
      text: src.text,
      timerMinutes: src.timerMinutes,
      start,
      minutes,
      wait,
      background: wait ? (o.p?.background?.slice(0, 80) ?? null) : null,
      equipment: o.p?.equipment ?? 'NONE',
      estimated: !src.timerMinutes,
    });
  }
  const end = Math.max(cursor, ...readyAt.values(), 0);
  const windows = steps
    .filter((s) => s.equipment === 'OVEN' && s.wait)
    .map((s) => ({ from: s.start, to: s.start + s.minutes + s.wait }))
    .sort((a, b) => a.from - b.from);
  const oven: { from: number; to: number }[] = [];
  for (const w of windows) {
    const last = oven.at(-1);
    if (last && w.from <= last.to) last.to = Math.max(last.to, w.to);
    else oven.push({ ...w });
  }
  return { steps, end, handsOn, oven };
}
