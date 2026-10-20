/**
 * Asystent - czysta logika bez AI: "co kupujesz regularnie, a się kończy" i zamiana
 * zaproponowanego planu na posiłki w planerze (z gotowaniem partiami).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Purchase {
  ingredientId: string;
  on: Date;
  grams: number;
}

export interface DueItem {
  ingredientId: string;
  /** Co ile dni zwykle kupowany */
  everyDays: number;
  /** Ile dni temu ostatnio */
  lastDaysAgo: number;
  /** Typowa ilość jednego zakupu */
  grams: number;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Produkty kupowane co najmniej 2 razy (różne dni), u których minęło już ~80% zwykłego odstępu.
 * Produktów, których dawno nie kupujesz (ponad 3 odstępy), nie podpowiadamy.
 */
export function duePurchases(purchases: Purchase[], today: Date): DueItem[] {
  const byIngredient = new Map<string, Map<number, number>>();
  for (const p of purchases) {
    const day = Math.floor(p.on.getTime() / DAY_MS);
    const days = byIngredient.get(p.ingredientId) ?? new Map<number, number>();
    days.set(day, (days.get(day) ?? 0) + p.grams);
    byIngredient.set(p.ingredientId, days);
  }
  const now = Math.floor(today.getTime() / DAY_MS);
  const due: DueItem[] = [];
  for (const [ingredientId, days] of byIngredient) {
    const sorted = [...days.keys()].sort((a, b) => a - b);
    if (sorted.length < 2) continue;
    const gaps = sorted.slice(1).map((d, i) => d - sorted[i]);
    const everyDays = Math.max(1, Math.round(median(gaps)));
    const lastDaysAgo = now - sorted[sorted.length - 1];
    if (lastDaysAgo < everyDays * 0.8 || lastDaysAgo > everyDays * 3) continue;
    due.push({ ingredientId, everyDays, lastDaysAgo, grams: Math.round(median([...days.values()])) });
  }
  return due.sort((a, b) => b.lastDaysAgo / b.everyDays - a.lastDaysAgo / a.everyDays);
}

export interface ProposedMeal {
  /** 1 = pierwszy dzień planu */
  day: number;
  slot: string;
  recipeId: string;
  /** Porcje z gotowania tego samego przepisu wcześniej w planie */
  leftover: boolean;
}

export interface PlannerMeal {
  date: string;
  slot: string;
  recipeId: string;
  servings: number;
  /** Tyle porcji ugotować (z zapasem na kolejne dni) - tylko przy gotowaniu */
  cookServings?: number;
  /** Indeks posiłku, z którego partii jemy (resztki) */
  fromIndex?: number;
}

/**
 * Plan → posiłki planera. Resztki szukają wcześniejszego gotowania tego samego przepisu;
 * jego partia rośnie o porcje resztek. Bez wcześniejszego gotowania resztki stają się gotowaniem.
 */
export function toPlannerMeals(
  meals: ProposedMeal[],
  dates: string[],
  people: number,
  slotOrder: readonly string[],
): PlannerMeal[] {
  const ordered = [...meals].sort(
    (a, b) => a.day - b.day || slotOrder.indexOf(a.slot) - slotOrder.indexOf(b.slot),
  );
  const out: PlannerMeal[] = [];
  for (const m of ordered) {
    const base = { date: dates[m.day - 1], slot: m.slot, recipeId: m.recipeId, servings: people };
    const sourceIndex = m.leftover
      ? out.findIndex((o) => o.recipeId === m.recipeId && o.fromIndex === undefined)
      : -1;
    if (sourceIndex >= 0) {
      const source = out[sourceIndex];
      source.cookServings = (source.cookServings ?? source.servings) + people;
      out.push({ ...base, fromIndex: sourceIndex });
    } else {
      out.push({ ...base });
    }
  }
  return out;
}
