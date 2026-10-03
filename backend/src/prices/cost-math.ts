/**
 * Koszty - czysta logika. Ceny trzymamy w groszach za opakowanie; do liczenia
 * przeliczamy je na grosze za gram.
 */

export interface CostResult {
  /** Szacowany koszt w groszach (tylko wycenione składniki) */
  cents: number;
  /** Ile składników miało cenę */
  priced: number;
  /** Składniki bez ceny w cenniku */
  missing: string[];
}

/** Koszt potrzebnych gramów składników wg cen za gram */
export function costOf(need: Map<string, number>, centsPerGram: Map<string, number>): CostResult {
  let cents = 0;
  let priced = 0;
  const missing: string[] = [];
  for (const [ingredientId, grams] of need) {
    const price = centsPerGram.get(ingredientId);
    if (price === undefined) {
      missing.push(ingredientId);
      continue;
    }
    cents += grams * price;
    priced++;
  }
  return { cents: Math.round(cents), priced, missing };
}

/**
 * Jednostki opakowania: kg i l przeliczamy na g i ml, resztę (g, ml, sztuki, puszki...)
 * zostawiamy do przeliczenia przez gęstość / wagę jednostki składnika.
 */
export function normalizePackageUnit(amount: number, unitCode: string): { amount: number; unitCode: string } {
  if (unitCode === 'kg') return { amount: amount * 1000, unitCode: 'g' };
  if (unitCode === 'l') return { amount: amount * 1000, unitCode: 'ml' };
  return { amount, unitCode };
}

/** Cena jednostkowa do porównań na półce: za kg, za l (płyny) albo za sztukę */
export function unitPrice(
  entry: { priceCents: number; packageGrams: number },
  ingredient: { density: number | null; pieceGrams: number | null; liquid: boolean },
): { cents: number; per: 'kg' | 'l' | 'PIECE' } {
  const perGram = entry.priceCents / entry.packageGrams;
  if (ingredient.pieceGrams) return { cents: Math.round(perGram * ingredient.pieceGrams), per: 'PIECE' };
  if (ingredient.liquid && ingredient.density) {
    return { cents: Math.round(perGram * 1000 * ingredient.density), per: 'l' };
  }
  return { cents: Math.round(perGram * 1000), per: 'kg' };
}
