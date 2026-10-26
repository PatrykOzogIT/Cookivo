/**
 * Zapis przepisów z pliku importu w bazie: idempotentnie (RecipeSource.externalId), partiami
 * w transakcjach, dry run = te same zapisy wycofane na końcu każdej partii.
 * Nigdy nie zmienia istniejących przepisów - przepis z tym samym źródłem albo tytułem jest pomijany.
 */
import { unitAllowed } from '../../../src/ai/ingredient-names.js';
import { normalizeSearch } from '../../../src/common/text.js';
import type { Prisma, PrismaClient } from '../../../src/generated/prisma/client.js';
import type { PrismaService } from '../../../src/prisma/prisma.service.js';
import {
  RecipeCalculatorService,
  ingredientForMath,
} from '../../../src/recipes/recipe-calculator.service.js';
import { gramsFor } from '../../../src/recipes/recipe-math.js';
import type { UnitEstimates } from './build.js';
import type { RecipeRecord } from './record.js';

/** Konto techniczne - właściciel przepisów z biblioteki (nazwa zastrzeżona przy rejestracji) */
export const SYSTEM_USERNAME = 'Cookivo';
export const SYSTEM_EMAIL = 'przepisy@cookivo.pl';

export type Action =
  | 'INSERT'
  | 'ALREADY_IMPORTED'
  | 'DUPLICATE_TITLE'
  | 'INGREDIENT_MISSING'
  | 'UNIT_NOT_ALLOWED'
  | 'MEAL_TYPE_UNKNOWN';

export interface PlanItem {
  record: RecipeRecord;
  action: Action;
  detail?: string;
}

export interface ImportOptions {
  dryRun: boolean;
  /** Szacunki wag miar (unit-estimates.json) - brakujące miary zapisujemy w bazie jako `AI` */
  unitEstimates?: UnitEstimates;
  limit?: number;
  batchSize?: number;
  log?: (msg: string) => void;
}

class Rollback extends Error {}

type Ing = Prisma.IngredientGetPayload<{ include: { units: true } }>;

async function systemAuthor(tx: Prisma.TransactionClient): Promise<string> {
  const found = await tx.user.findUnique({ where: { usernameNormalized: SYSTEM_USERNAME.toLowerCase() } });
  if (found) {
    if (found.email !== SYSTEM_EMAIL)
      throw new Error(`Konto "${SYSTEM_USERNAME}" istnieje, ale to nie konto techniczne.`);
    return found.id;
  }
  const created = await tx.user.create({
    data: {
      username: SYSTEM_USERNAME,
      usernameNormalized: SYSTEM_USERNAME.toLowerCase(),
      email: SYSTEM_EMAIL,
      // Nieprawidłowy skrót - na to konto nie da się zalogować
      passwordHash: '!',
      emailVerifiedAt: new Date(),
    },
  });
  return created.id;
}

/** Miara z szacunku do zapisu w bazie przed przepisem */
interface UnitInsert {
  ingredientId: string;
  unitCode: string;
  grams: number;
}

export async function plan(prisma: PrismaClient, records: RecipeRecord[], estimates: UnitEstimates = {}) {
  const unitInserts = new Map<string, UnitInsert>();
  /** Klucze miar z szacunku potrzebne przepisowi */
  const recordUnits = new Map<string, string[]>();
  const [sources, ingredients, mealTypes, recipes, units] = await Promise.all([
    prisma.recipeSource.findMany({
      where: { externalId: { in: records.map((r) => r.key) } },
      select: { externalId: true },
    }),
    prisma.ingredient.findMany({ where: { status: 'APPROVED' }, include: { units: true } }),
    prisma.mealType.findMany({ select: { code: true } }),
    // Tytuły istniejących przepisów publicznych spoza biblioteki - nie dublujemy
    prisma.recipe.findMany({ where: { visibility: 'PUBLIC', source: null }, select: { title: true } }),
    prisma.unit.findMany(),
  ]);
  const imported = new Set(sources.map((s) => s.externalId));
  const byName = new Map(ingredients.map((i) => [normalizeSearch(i.namePl), i]));
  const knownMeals = new Set(mealTypes.map((m) => m.code));
  const titles = new Set(recipes.map((r) => normalizeSearch(r.title)));
  const unitMl = Object.fromEntries(units.map((u) => [u.code, u.ml]));

  const items: PlanItem[] = records.map((record) => {
    if (imported.has(record.key)) return { record, action: 'ALREADY_IMPORTED' };
    if (titles.has(normalizeSearch(record.title))) return { record, action: 'DUPLICATE_TITLE' };
    const unknownMeal = record.mealTypes.find((m) => !knownMeals.has(m));
    if (unknownMeal) return { record, action: 'MEAL_TYPE_UNKNOWN', detail: unknownMeal };
    for (const l of record.ingredients) {
      const ing = byName.get(normalizeSearch(l.ingredient));
      if (!ing) return { record, action: 'INGREDIENT_MISSING', detail: l.ingredient };
      const shape = { density: ing.density, units: ing.units.map((u) => ({ code: u.unitCode })) };
      if (!unitAllowed(l.unitCode, shape, unitMl)) {
        const grams = estimates[normalizeSearch(ing.namePl)]?.grams[l.unitCode];
        if (!grams) return { record, action: 'UNIT_NOT_ALLOWED', detail: `${l.ingredient} (${l.unitCode})` };
        // Szacunek: w pamięci od razu (gramy pozycji), w bazie razem z przepisem
        const key = `${ing.id}|${l.unitCode}`;
        unitInserts.set(key, { ingredientId: ing.id, unitCode: l.unitCode, grams });
        ing.units.push({ ingredientId: ing.id, unitCode: l.unitCode, grams, basis: 'AI' });
        recordUnits.set(record.key, [...(recordUnits.get(record.key) ?? []), key]);
      }
    }
    return { record, action: 'INSERT' };
  });
  return { items, byName, unitMl, unitInserts, recordUnits };
}

async function insertRecipe(
  tx: Prisma.TransactionClient,
  calculator: RecipeCalculatorService,
  r: RecipeRecord,
  authorId: string,
  byName: Map<string, Ing>,
  unitMl: Record<string, number | null>,
): Promise<void> {
  const lines = r.ingredients.map((l, position) => {
    const ing = byName.get(normalizeSearch(l.ingredient))!;
    const grams = gramsFor(l.amount, l.unitCode, { ingredient: ingredientForMath(ing) }, unitMl);
    if (grams === 'UNIT_NOT_ALLOWED') throw new Error(`${r.key}: ${l.ingredient} ${l.unitCode}`);
    return {
      position,
      ingredientId: ing.id,
      amount: l.amount,
      unitCode: l.unitCode,
      grams: Math.round(grams * 10) / 10,
      groupName: l.groupName,
      note: l.note,
    };
  });
  const recipe = await tx.recipe.create({
    data: {
      authorId,
      title: r.title,
      description: r.description,
      // Wyszukiwanie po obu językach
      searchText: normalizeSearch(`${r.title} ${r.translation.title}`),
      servings: r.servings,
      prepMinutes: r.prepMinutes,
      cookMinutes: r.cookMinutes,
      difficulty: r.difficulty,
      visibility: 'PUBLIC',
      mealTypes: { create: r.mealTypes.map((mealTypeCode) => ({ mealTypeCode })) },
      ingredients: { create: lines },
      steps: {
        create: r.steps.map((s, position) => ({ position, text: s.text, timerMinutes: s.timerMinutes })),
      },
      translations: {
        create: [
          {
            locale: r.translation.locale,
            title: r.translation.title,
            description: r.translation.description,
            steps: r.translation.steps,
            lines: r.translation.lines,
          },
        ],
      },
      source: {
        create: {
          externalId: r.key,
          revisionId: String(r.revId),
          sourceName: r.source.sourceName,
          sourceLocale: r.source.sourceLocale,
          sourceTitle: r.source.sourceTitle,
          url: r.source.url,
          historyUrl: r.source.historyUrl,
          license: r.source.license,
          licenseUrl: r.source.licenseUrl,
          changes: r.source.changes,
          datasetVersion: r.source.datasetVersion,
        },
      },
    },
    select: { id: true },
  });
  if (r.photo) {
    await tx.photo.create({
      data: {
        id: r.photo.id,
        ownerId: authorId,
        recipeId: recipe.id,
        position: 0,
        width: r.photo.width,
        height: r.photo.height,
        bytes: r.photo.bytes,
        creditAuthor: r.photo.author,
        creditLicense: r.photo.license,
        creditLicenseUrl: r.photo.licenseUrl,
        creditSourceUrl: r.photo.sourceUrl,
      },
    });
  }
  await calculator.recalculate(recipe.id, tx);
}

export async function runImport(prisma: PrismaClient, records: RecipeRecord[], opts: ImportOptions) {
  const started = Date.now();
  const { items, byName, unitMl, unitInserts, recordUnits } = await plan(prisma, records, opts.unitEstimates);
  const todo = items.filter((p) => p.action === 'INSERT').slice(0, opts.limit ?? Infinity);
  const skipped: Record<string, number> = {};
  for (const p of items) if (p.action !== 'INSERT') skipped[p.action] = (skipped[p.action] ?? 0) + 1;
  const calculator = new RecipeCalculatorService(prisma as unknown as PrismaService);
  const size = opts.batchSize ?? 25;
  let inserted = 0;
  let batches = 0;
  for (let i = 0; i < todo.length; i += size) {
    const chunk = todo.slice(i, i + size);
    try {
      await prisma.$transaction(
        async (tx) => {
          const authorId = await systemAuthor(tx);
          // Miary z szacunku potrzebne tej partii (już zapisane - pomijane)
          const keys = new Set(chunk.flatMap((p) => recordUnits.get(p.record.key) ?? []));
          if (keys.size) {
            await tx.ingredientUnit.createMany({
              data: [...keys].map((k) => ({ ...unitInserts.get(k)!, basis: 'AI' as const })),
              skipDuplicates: true,
            });
          }
          for (const p of chunk) await insertRecipe(tx, calculator, p.record, authorId, byName, unitMl);
          if (opts.dryRun) throw new Rollback();
        },
        { timeout: 120_000, maxWait: 20_000 },
      );
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
    inserted += chunk.length;
    batches++;
    opts.log?.(`  partia ${batches}: ${inserted}/${todo.length}`);
  }
  return {
    mode: opts.dryRun ? 'dry-run' : 'import',
    planned: todo.length,
    inserted,
    batches,
    skipped,
    /** Miary z szacunku AI zapisane razem z przepisami */
    estimatedUnits: new Set(todo.flatMap((p) => recordUnits.get(p.record.key) ?? [])).size,
    ms: Date.now() - started,
    plan: items,
  };
}

/**
 * Cofnięcie importu: usuwa przepisy z biblioteki, których nikt jeszcze nie używa
 * (bez ocen, planów, wersji i użycia jako składnik). Pliki zdjęć na serwerze zostają.
 */
export async function undoImport(prisma: PrismaClient, dryRun: boolean) {
  const all = await prisma.recipe.findMany({
    where: { source: { isNot: null }, author: { usernameNormalized: SYSTEM_USERNAME.toLowerCase() } },
    select: {
      id: true,
      _count: { select: { ratings: true, planCooks: true, variants: true, usedIn: true, reports: true } },
    },
  });
  const removable = all.filter((r) => Object.values(r._count).every((n) => n === 0)).map((r) => r.id);
  if (!dryRun && removable.length) await prisma.recipe.deleteMany({ where: { id: { in: removable } } });
  return { removable: removable.length, kept: all.length - removable.length };
}
