import type { Ingredient, Localized, Unit } from './ingredients.models';

export interface PortionUnit {
  code: string;
  /** Klucz tłumaczenia (g, ml) albo nazwa jednostki ze słownika */
  key?: string;
  name?: Localized;
  gramsPerUnit: number;
}

/**
 * Jednostki, w których można podać porcję danego składnika:
 * gramy, ml (płyny z gęstością), jednostki zdefiniowane przy składniku
 * oraz jednostki objętościowe (łyżka, szklanka) wyliczone z gęstości.
 */
export function portionUnits(ingredient: Ingredient, dictionary: Unit[]): PortionUnit[] {
  const units: PortionUnit[] = [{ code: 'g', key: 'units.g', gramsPerUnit: 1 }];
  const density = ingredient.density;
  if (density) units.push({ code: 'ml', key: 'units.ml', gramsPerUnit: density });

  for (const u of ingredient.units) {
    units.push({ code: u.code, name: u, gramsPerUnit: u.grams });
  }
  if (density) {
    for (const u of dictionary) {
      if (u.ml && !ingredient.units.some((own) => own.code === u.code)) {
        units.push({ code: u.code, name: u, gramsPerUnit: u.ml * density });
      }
    }
  }
  return units;
}

export function portionGrams(amount: number, unit: PortionUnit | undefined): number | null {
  if (!unit || !Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * unit.gramsPerUnit * 10) / 10;
}
