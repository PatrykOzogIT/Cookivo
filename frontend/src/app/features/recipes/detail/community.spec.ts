import type { RecipeDetail, VariantSummary } from '../recipes.models';
import { variantDiff } from './recipe-community';

describe('różnice wariantu', () => {
  const allergen = (code: string) => ({ code, namePl: code, nameEn: code, icon: '' });

  it('kcal na porcję i alergeny, których nie ma / które doszły', () => {
    const current = {
      kcalPerServing: 420,
      allergens: [allergen('GLUTEN'), allergen('EGGS')],
    } as RecipeDetail;
    const variant = {
      kcalPerServing: 300.4,
      allergens: [allergen('EGGS'), allergen('NUTS')],
    } as unknown as VariantSummary;
    const d = variantDiff(current, variant);
    expect(d.kcal).toBe(-120);
    expect(d.without.map((a) => a.code)).toEqual(['GLUTEN']);
    expect(d.with.map((a) => a.code)).toEqual(['NUTS']);
  });
});
