/**
 * Dane startowe: alergeny, kategorie, jednostki i składniki z USDA oraz ANSES Ciqual.
 * Idempotentny - można uruchamiać wielokrotnie, aktualizuje istniejące wpisy.
 * Uruchamianie: `npm run db:seed` (run-seed.ts); używany też w testach e2e.
 */
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { normalizeSearch } from '../../src/common/text.js';
import ciqualData from './ciqual.data.json' with { type: 'json' };
import { INGREDIENT_CATALOG } from './ingredients.catalog.js';
import { CIQUAL_CATALOG } from './ingredients.ciqual.js';
import usdaData from './ingredients.data.json' with { type: 'json' };
import { ALLERGENS, CATEGORIES, MEAL_TYPES, UNITS } from './reference-data.js';

export interface NutritionValues {
  kcal: number;
  protein: number;
  fat: number;
  saturatedFat: number | null;
  carbs: number;
  sugars: number | null;
  fiber: number | null;
  salt: number | null;
}

const usda = usdaData as Record<string, NutritionValues & { fdcId: number }>;
const ciqual = ciqualData as Record<string, NutritionValues & { nameFr: string; nameEn: string }>;

/** Wpis do zapisania - wspólny kształt dla obu źródeł */
export interface SeedItem {
  seedKey: string;
  source: 'USDA' | 'CIQUAL';
  sourceRef: string;
  pl: string;
  en: string;
  category: string;
  allergens?: readonly string[];
  units?: Partial<Record<string, number>>;
  density?: number;
  nutrition: NutritionValues;
}

/** Oba katalogi jako jedna lista. Klucz seeda z nazwy - zmiana źródła wartości nie dubluje składnika. */
export function seedItems(): SeedItem[] {
  const fromUsda = INGREDIENT_CATALOG.map((item): SeedItem => {
    const values = usda[item.usda];
    if (!values) throw new Error(`Brak danych USDA dla "${item.pl}" - uruchom tools/usda-extract.ts`);
    const { fdcId, ...nutrition } = values;
    return {
      ...item,
      seedKey: `usda:${normalizeSearch(item.pl)}`,
      source: 'USDA',
      sourceRef: String(fdcId),
      nutrition,
    };
  });
  const fromCiqual = CIQUAL_CATALOG.map((item): SeedItem => {
    const values = ciqual[String(item.ciqual)];
    if (!values) throw new Error(`Brak danych Ciqual dla "${item.pl}" - uruchom tools/ciqual-extract.ts`);
    const { nameFr: _fr, nameEn: _en, ...nutrition } = values;
    return {
      ...item,
      seedKey: `ciqual:${normalizeSearch(item.pl)}`,
      source: 'CIQUAL',
      sourceRef: String(item.ciqual),
      nutrition,
    };
  });
  return [...fromUsda, ...fromCiqual];
}

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

  for (const [i, m] of MEAL_TYPES.entries()) {
    const data = { namePl: m.pl, nameEn: m.en, icon: m.icon, sortOrder: i };
    await prisma.mealType.upsert({
      where: { code: m.code },
      create: { code: m.code, ...data },
      update: data,
    });
  }

  const allergenIds = new Map((await prisma.allergen.findMany()).map((a) => [a.code, a.id]));
  const categoryIds = new Map((await prisma.ingredientCategory.findMany()).map((c) => [c.code, c.id]));

  const items = seedItems();
  for (const item of items) {
    const { seedKey } = item;
    const data = {
      namePl: item.pl,
      nameEn: item.en,
      searchText: normalizeSearch(`${item.pl} ${item.en}`),
      categoryId: categoryIds.get(item.category)!,
      status: 'APPROVED' as const,
      source: item.source,
      sourceRef: item.sourceRef,
      density: item.density ?? null,
      ...item.nutrition,
    };

    // Nowa pozycja katalogu, a ta nazwa jest już zajęta (np. przez import składników albo
    // zatwierdzony składnik użytkownika) - pomijamy, żeby wdrożenie nie padło na unikalnej nazwie
    const own = await prisma.ingredient.findUnique({ where: { seedKey }, select: { id: true } });
    if (!own) {
      const taken = await prisma.ingredient.findFirst({
        where: { status: 'APPROVED', namePl: { equals: item.pl, mode: 'insensitive' } },
        select: { id: true },
      });
      if (taken) {
        console.warn(`Seed: pomijam "${item.pl}" - nazwa już zajęta w bazie.`);
        continue;
      }
    }

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
          data: units.map(([unitCode, grams]) => ({ ingredientId: ingredient.id, unitCode, grams: grams! })),
        });
      }
    });
  }

  return { ingredients: items.length };
}
