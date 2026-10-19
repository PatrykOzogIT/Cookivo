import type { LineItem } from '../recipes/recipe-units';
import type { ShoppingAmount } from './shopping.api';

const METRIC = new Set(['g', 'kg', 'ml', 'l']);

/**
 * Ilość na liście zakupów: "3 szt. (ok. 450 g)", "1,25 kg", "500 ml".
 * `piece` to skrót sztuki w danym języku ("szt." / "pcs"). Ilość wpisana ręcznie zostaje w swojej
 * jednostce ("5 szt.", "2 puszki" - te ostatnie przez `unitLabel`, z polską odmianą).
 */
export function formatShoppingAmount(
  a: ShoppingAmount,
  lang: string,
  piece: string,
  about: string,
  unitLabel?: (unitCode: string, amount: number) => string,
): string {
  const fmt = (n: number) =>
    new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'pl-PL', { maximumFractionDigits: 2 }).format(n);
  if (a.unit === 'PIECE')
    return a.manual ? `${fmt(a.amount)} ${piece}` : `${fmt(a.amount)} ${piece} (${about} ${fmt(a.grams)} g)`;
  if (METRIC.has(a.unit) || !unitLabel) return `${fmt(a.amount)} ${a.unit}`;
  return unitLabel(a.unit, a.amount);
}

/** Domyślnie sztuki (banany, jajka), w pozostałych przypadkach kilogramy (ryż, mąka) */
export function defaultShoppingUnit(item: LineItem): string {
  return item.units?.some((u) => u.code === 'PIECE') ? 'PIECE' : 'kg';
}

/** Grupy działów sklepu w kolejności kategorii; własne pozycje na końcu */
export function groupByCategory<
  T extends { ingredient: { category: { code: string; sortOrder: number } } | null },
>(items: T[]): { code: string; items: T[] }[] {
  const groups = new Map<string, { code: string; order: number; items: T[] }>();
  for (const item of items) {
    const cat = item.ingredient?.category;
    const code = cat?.code ?? 'CUSTOM';
    const g = groups.get(code) ?? { code, order: cat?.sortOrder ?? 9999, items: [] };
    g.items.push(item);
    groups.set(code, g);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order).map(({ code, items }) => ({ code, items }));
}
