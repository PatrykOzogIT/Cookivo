import {
  derivedNutrition,
  effectiveGrams,
  gramsFor,
  sumNutrition,
  type IngredientForMath,
  type NutritionValues,
  type SubRecipeForMath,
} from './recipe-math.js';

const n = (v: Partial<NutritionValues>): NutritionValues => ({
  kcal: 0,
  protein: 0,
  fat: 0,
  saturatedFat: 0,
  carbs: 0,
  sugars: 0,
  fiber: 0,
  salt: 0,
  ...v,
});

const unitMl = { TABLESPOON: 15, GLASS: 250, PIECE: null };
const egg: IngredientForMath = {
  nutrition: n({ kcal: 143, protein: 12.6 }),
  density: null,
  units: { PIECE: 50 },
};
const milk: IngredientForMath = { nutrition: n({ kcal: 61, protein: 3.2 }), density: 1.03, units: {} };
const honey: IngredientForMath = { nutrition: n({ kcal: 304 }), density: 1.42, units: { TABLESPOON: 21 } };

describe('gramsFor', () => {
  it('gramy, sztuki, ml i jednostki objętościowe z gęstości', () => {
    expect(gramsFor(120, 'g', { ingredient: egg }, unitMl)).toBe(120);
    expect(gramsFor(3, 'PIECE', { ingredient: egg }, unitMl)).toBe(150);
    expect(gramsFor(200, 'ml', { ingredient: milk }, unitMl)).toBeCloseTo(206);
    expect(gramsFor(1, 'GLASS', { ingredient: milk }, unitMl)).toBeCloseTo(257.5);
  });

  it('jednostka zdefiniowana przy składniku ma pierwszeństwo przed gęstością', () => {
    expect(gramsFor(2, 'TABLESPOON', { ingredient: honey }, unitMl)).toBe(42);
  });

  it('odrzuca jednostki, których nie da się przeliczyć', () => {
    expect(gramsFor(1, 'ml', { ingredient: egg }, unitMl)).toBe('UNIT_NOT_ALLOWED');
    expect(gramsFor(1, 'GLASS', { ingredient: egg }, unitMl)).toBe('UNIT_NOT_ALLOWED');
    expect(gramsFor(1, 'NIEZNANA', { ingredient: egg }, unitMl)).toBe('UNIT_NOT_ALLOWED');
  });

  it('podprzepis: gramy albo porcje gotowej potrawy (z wagą po ugotowaniu)', () => {
    const broth: SubRecipeForMath = { servings: 4, totalGrams: 2400, cookedGrams: 2000, totals: n({}) };
    expect(gramsFor(1, 'SERVING', { subRecipe: broth }, unitMl)).toBe(500);
    expect(gramsFor(300, 'g', { subRecipe: broth }, unitMl)).toBe(300);
    expect(gramsFor(1, 'PIECE', { subRecipe: broth }, unitMl)).toBe('UNIT_NOT_ALLOWED');
  });
});

describe('sumNutrition', () => {
  it('sumuje składniki proporcjonalnie do wagi', () => {
    const t = sumNutrition([
      { grams: 100, ingredient: egg },
      { grams: 200, ingredient: milk },
    ]);
    expect(t.kcal).toBeCloseTo(143 + 122);
    expect(t.protein).toBeCloseTo(12.6 + 6.4);
  });

  it('brak danych w jednym składniku daje brak danych w sumie (nie zero)', () => {
    const noSugar: IngredientForMath = { ...egg, nutrition: n({ kcal: 10, sugars: null }) };
    const t = sumNutrition([
      { grams: 100, ingredient: milk },
      { grams: 50, ingredient: noSugar },
    ]);
    expect(t.sugars).toBeNull();
    expect(t.kcal).toBeCloseTo(66);
  });

  it('podprzepis wnosi część swoich sum proporcjonalnie do użytej wagi gotowej potrawy', () => {
    const broth: SubRecipeForMath = {
      servings: 4,
      totalGrams: 2400,
      cookedGrams: 2000,
      totals: n({ kcal: 800, protein: 60 }),
    };
    const t = sumNutrition([{ grams: 500, subRecipe: broth }]); // 1/4 gotowego rosołu
    expect(t.kcal).toBeCloseTo(200);
    expect(t.protein).toBeCloseTo(15);
  });
});

describe('derivedNutrition', () => {
  const totals = n({ kcal: 1000, protein: 40, sugars: null });

  it('bez wagi po ugotowaniu: na 100 g z sumy składników, oznaczone jako przybliżone', () => {
    const d = derivedNutrition({ totals, totalGrams: 500, cookedGrams: null, servings: 4 });
    expect(d.per100g?.kcal).toBe(200);
    expect(d.perServing.kcal).toBe(250);
    expect(d.servingGrams).toBe(125);
    expect(d.approximate).toBe(true);
    expect(d.per100g?.sugars).toBeNull();
  });

  it('z wagą po ugotowaniu: dokładne na 100 g, porcja bez zmian', () => {
    const d = derivedNutrition({ totals, totalGrams: 500, cookedGrams: 400, servings: 4 });
    expect(d.per100g?.kcal).toBe(250);
    expect(d.perServing.kcal).toBe(250);
    expect(d.servingGrams).toBe(100);
    expect(d.approximate).toBe(false);
  });

  it('effectiveGrams ignoruje zerową wagę po ugotowaniu', () => {
    expect(effectiveGrams({ totalGrams: 300, cookedGrams: 0 })).toBe(300);
  });
});
