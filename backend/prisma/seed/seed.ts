/**
 * Dane startowe: alergeny, kategorie, jednostki i składniki z USDA.
 * Idempotentny - można uruchamiać wielokrotnie, aktualizuje istniejące wpisy.
 * Uruchamianie: `npm run db:seed` (run-seed.ts); używany też w testach e2e.
 */
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { normalizeSearch } from '../../src/common/text.js';
import { INGREDIENT_CATALOG } from './ingredients.catalog.js';
import usdaData from './ingredients.data.json' with { type: 'json' };
import { ALLERGENS, CATEGORIES, UNITS } from './reference-data.js';

interface UsdaValues {
  fdcId: number;
  kcal: number;
  protein: number;
  fat: number;
  saturatedFat: number | null;
  carbs: number;
  sugars: number | null;
  fiber: number | null;
  salt: number | null;
}

const usda = usdaData as Record<string, UsdaValues>;

export async function seed(prisma: PrismaClient): Promise<{ ingredients: number }> {
  for (const [i, a] of ALLERGENS.entries()) {
    const data = { namePl: a.pl, nameEn: a.en, icon: a.icon, sortOrder: i };
    await prisma.allergen.upsert({
      where: { code: a.code },
      create: { code: a.code, ...data },
      update: data,
    });
  }
  for (const [i, c] of CATEGORIES.entries()) {
    const data = { namePl: c.pl, nameEn: c.en, icon: c.icon, sortOrder: i };
    await prisma.ingredientCategory.upsert({
      where: { code: c.code },
      create: { code: c.code, ...data },
      update: data,
    });
  }
  for (const [i, u] of UNITS.entries()) {
    const data = { namePl: u.pl, nameEn: u.en, ml: u.ml, sortOrder: i };
    await prisma.unit.upsert({ where: { code: u.code }, create: { code: u.code, ...data }, update: data });
  }

  const allergenIds = new Map((await prisma.allergen.findMany()).map((a) => [a.code, a.id]));
  const categoryIds = new Map((await prisma.ingredientCategory.findMany()).map((c) => [c.code, c.id]));

  for (const item of INGREDIENT_CATALOG) {
    const values = usda[item.usda];
    if (!values) throw new Error(`Brak danych USDA dla "${item.pl}" - uruchom tools/usda-extract.ts`);
    const { fdcId, ...nutrition } = values;
    const seedKey = `usda:${normalizeSearch(item.pl)}`;

    const data = {
      namePl: item.pl,
      nameEn: item.en,
      searchText: normalizeSearch(`${item.pl} ${item.en}`),
      categoryId: categoryIds.get(item.category)!,
      status: 'APPROVED' as const,
      source: 'USDA' as const,
      sourceRef: String(fdcId),
      density: item.density ?? null,
      ...nutrition,
    };

    await prisma.$transaction(async (tx) => {
      const ingredient = await tx.ingredient.upsert({
        where: { seedKey },
        create: { seedKey, ...data },
        update: data,
      });
      await tx.ingredientAllergen.deleteMany({ where: { ingredientId: ingredient.id } });
      await tx.ingredientUnit.deleteMany({ where: { ingredientId: ingredient.id } });
      if (item.allergens?.length) {
        await tx.ingredientAllergen.createMany({
          data: item.allergens.map((code) => ({
            ingredientId: ingredient.id,
            allergenId: allergenIds.get(code)!,
          })),
        });
      }
      const units = Object.entries(item.units ?? {});
      if (units.length) {
        await tx.ingredientUnit.createMany({
          data: units.map(([unitCode, grams]) => ({ ingredientId: ingredient.id, unitCode, grams })),
        });
      }
    });
  }

  return { ingredients: INGREDIENT_CATALOG.length };
}
