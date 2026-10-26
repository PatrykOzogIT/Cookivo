/**
 * Miary kuchenne zawsze dostępne w formularzu przepisu i kontrola ich wag (szacunek AI,
 * wartość od użytkownika). Czysta logika - używana przez API i import biblioteki przepisów.
 * Zakresy zdublowane we froncie: `features/recipes/kitchen-units.ts` - zmieniać razem.
 */
export const KITCHEN_UNITS = ['TEASPOON', 'TABLESPOON', 'GLASS', 'PINCH', 'PIECE'] as const;
export type KitchenUnit = (typeof KITCHEN_UNITS)[number];

/** Rozsądna waga 1 miary w gramach (płaska łyżka / łyżeczka, szklanka 250 ml) */
export const UNIT_RANGES: Record<KitchenUnit, [number, number]> = {
  TEASPOON: [0.5, 15],
  TABLESPOON: [1.5, 45],
  GLASS: [30, 450],
  PINCH: [0.05, 2],
  PIECE: [0.3, 5000],
};

export const isKitchenUnit = (code: string): code is KitchenUnit =>
  (KITCHEN_UNITS as readonly string[]).includes(code);

export function inUnitRange(code: string, grams: number): boolean {
  if (!isKitchenUnit(code) || !Number.isFinite(grams)) return false;
  const [min, max] = UNIT_RANGES[code];
  return grams >= min && grams <= max;
}

export type UnitEstimate = Partial<Record<KitchenUnit, number | null>>;

/**
 * Szacunek do zapisu: tylko wartości w zakresach; łyżeczka, łyżka i szklanka muszą do siebie pasować
 * (łyżka 2-4,5 × łyżeczka, szklanka 10-25 × łyżka) - inaczej odrzucamy wszystkie trzy.
 * `null` od modelu = miara nie pasuje do składnika (np. sztuka mąki).
 */
export function checkEstimate(e: UnitEstimate): {
  grams: Partial<Record<KitchenUnit, number>>;
  notFit: KitchenUnit[];
} {
  const grams: Partial<Record<KitchenUnit, number>> = {};
  const notFit: KitchenUnit[] = [];
  for (const code of KITCHEN_UNITS) {
    const v = e[code];
    if (v === null) notFit.push(code);
    else if (v !== undefined && inUnitRange(code, v)) grams[code] = Math.round(v * 10) / 10;
  }
  const { TEASPOON: tsp, TABLESPOON: tbsp, GLASS: glass } = grams;
  const ratio = (a: number | undefined, b: number | undefined, min: number, max: number) =>
    a === undefined || b === undefined || (a / b >= min && a / b <= max);
  if (!ratio(tbsp, tsp, 2, 4.5) || !ratio(glass, tbsp, 10, 25)) {
    delete grams.TEASPOON;
    delete grams.TABLESPOON;
    delete grams.GLASS;
  }
  return { grams, notFit };
}
