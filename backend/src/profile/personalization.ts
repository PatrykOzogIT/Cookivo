import { Prisma } from '../generated/prisma/client.js';

/**
 * Fragmenty SQL do dopasowania list do użytkownika.
 * Efektywna preferencja składnika = preferencja składnika, a jeśli jej brak - jego kategorii.
 */

/** Warunek: składnik `i` ma efektywną preferencję NEVER */
function neverIngredient(userId: string, alias: string): Prisma.Sql {
  const i = Prisma.raw(alias);
  // Brak preferencji = NULL; zewnętrzne coalesce daje false, bo NOT (NULL) odrzuciłby każdy wiersz
  return Prisma.sql`coalesce(coalesce(
    (SELECT ip.level FROM ingredient_preferences ip WHERE ip.user_id = ${userId}::uuid AND ip.ingredient_id = ${i}.id),
    (SELECT cp.level FROM category_preferences cp WHERE cp.user_id = ${userId}::uuid AND cp.category_id = ${i}.category_id)
  ) = 'NEVER', false)`;
}

/** Składnik bez alergenów użytkownika i nie oznaczony "nie proponuj" */
export function ingredientForMe(userId: string): Prisma.Sql {
  return Prisma.sql`NOT EXISTS (SELECT 1 FROM ingredient_allergens ia JOIN user_allergens ua
      ON ua.allergen_id = ia.allergen_id AND ua.user_id = ${userId}::uuid WHERE ia.ingredient_id = i.id)
    AND NOT (${neverIngredient(userId, 'i')})`;
}

/**
 * Przepis bez alergenów użytkownika (także z podprzepisów - są w recipe_allergens)
 * i bez bezpośrednich składników "nie proponuj".
 */
export function recipeForMe(userId: string): Prisma.Sql {
  return Prisma.sql`NOT EXISTS (SELECT 1 FROM recipe_allergens ra JOIN user_allergens ua
      ON ua.allergen_id = ra.allergen_id AND ua.user_id = ${userId}::uuid WHERE ra.recipe_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM recipe_ingredients ri JOIN ingredients ing ON ing.id = ri.ingredient_id
      WHERE ri.recipe_id = r.id AND ${neverIngredient(userId, 'ing')})`;
}

/** Punkty "dla Ciebie": bardzo lubię +2, lubię +1, czasami -1 (suma po składnikach przepisu) */
export function recipeScore(userId: string): Prisma.Sql {
  return Prisma.sql`(SELECT coalesce(sum(CASE coalesce(
      (SELECT ip.level FROM ingredient_preferences ip WHERE ip.user_id = ${userId}::uuid AND ip.ingredient_id = ing.id),
      (SELECT cp.level FROM category_preferences cp WHERE cp.user_id = ${userId}::uuid AND cp.category_id = ing.category_id))
      WHEN 'LOVE' THEN 2 WHEN 'LIKE' THEN 1 WHEN 'SOMETIMES' THEN -1 ELSE 0 END), 0)
    FROM recipe_ingredients ri JOIN ingredients ing ON ing.id = ri.ingredient_id WHERE ri.recipe_id = r.id)`;
}
