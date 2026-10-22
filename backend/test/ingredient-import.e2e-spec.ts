import pg from 'pg';
import { runImport, undoImport } from '../prisma/import/lib/importer.js';
import type { ImportRecord } from '../prisma/import/lib/record.js';
import { createTestApp } from './support/app.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const rec = (n: number, over: Partial<ImportRecord> = {}): ImportRecord => ({
  importKey: `usda:t${n}`,
  seedKey: `import:usda:t${n}`,
  namePl: `Testowy składnik żółć ${n}`,
  nameEn: `Test ingredient ${n}`,
  categoryCode: 'VEGETABLES',
  status: 'APPROVED',
  source: 'USDA',
  sourceRef: `t${n}`,
  kcal: 40,
  protein: 1,
  fat: 0.2,
  saturatedFat: null,
  carbs: 8,
  sugars: 4,
  fiber: 2,
  salt: 0.01,
  density: null,
  allergens: [],
  allergenBasis: 'RULE',
  units: [],
  relevance: 'COMMON',
  quality: { missing: ['saturatedFat'], filledFrom: [] },
  review: [],
  duplicates: [],
  ...over,
});

describe('Import składników do bazy (e2e)', () => {
  let t: TestApp;
  let db: pg.Client;

  beforeAll(async () => {
    t = await createTestApp();
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
  });

  beforeEach(async () => {
    await t.prisma.recipeIngredient.deleteMany({
      where: { ingredient: { seedKey: { startsWith: 'import:' } } },
    });
    await t.prisma.ingredient.deleteMany({ where: { seedKey: { startsWith: 'import:' } } });
  });

  afterAll(async () => {
    await t.prisma.ingredient.deleteMany({ where: { seedKey: { startsWith: 'import:' } } });
    await db.end();
    await t.app.close();
  });

  const imported = () => t.prisma.ingredient.count({ where: { seedKey: { startsWith: 'import:' } } });

  it('zapis z alergenami i jednostkami; ponowne uruchomienie niczego nie dubluje', async () => {
    const records = [
      rec(1, {
        namePl: 'Testowy seler naciowy',
        allergens: ['CELERY'],
        units: [{ code: 'PIECE', grams: 40, basis: 'SOURCE' }],
      }),
      rec(2, { status: 'PENDING', review: ['ZMIENNY_SKLAD'] }),
      rec(3, {
        categoryCode: 'BEVERAGES',
        density: 1.03,
        units: [{ code: 'GLASS', grams: 257.5, basis: 'DENSITY' }],
      }),
    ];
    const first = await runImport(db, records, { dryRun: false });
    // Rekord do weryfikacji (PENDING) czeka na przegląd - nie trafia do bazy
    expect(first).toMatchObject({ planned: 2, inserted: 2, approved: 2, pending: 0 });
    expect(await t.prisma.ingredient.count({ where: { seedKey: 'import:usda:t2' } })).toBe(0);

    const seler = await t.prisma.ingredient.findFirstOrThrow({
      where: { seedKey: 'import:usda:t1' },
      include: { allergens: { include: { allergen: true } }, units: true, category: true },
    });
    expect(seler).toMatchObject({
      namePl: 'Testowy seler naciowy',
      status: 'APPROVED',
      source: 'USDA',
      sourceRef: 't1',
      saturatedFat: null,
      searchText: 'testowy seler naciowy test ingredient 1',
    });
    expect(seler.reviewedAt).not.toBeNull();
    expect(seler.allergens.map((a) => a.allergen.code)).toEqual(['CELERY']);
    expect(seler.units).toEqual([expect.objectContaining({ unitCode: 'PIECE', grams: 40 })]);
    // Polskie znaki bez zmian
    expect(
      (await t.prisma.ingredient.findFirstOrThrow({ where: { seedKey: 'import:usda:t3' } })).namePl,
    ).toBe('Testowy składnik żółć 3');

    const again = await runImport(db, records, { dryRun: false });
    expect(again).toMatchObject({ planned: 0, inserted: 0, skipped: { ALREADY_IMPORTED: 2 } });
    expect(await imported()).toBe(2);

    // Po ręcznej weryfikacji rekord jest zatwierdzony i dochodzi przy kolejnym imporcie
    const reviewed = [
      records[0],
      { ...records[1], status: 'APPROVED' as const, review: ['ZWERYFIKOWANY_RECZNIE'] },
      records[2],
    ];
    expect(await runImport(db, reviewed, { dryRun: false })).toMatchObject({ inserted: 1, approved: 1 });
    expect(await imported()).toBe(3);
  });

  it('dry run nic nie zapisuje; przerwanie (limit) i wznowienie', async () => {
    const records = [rec(1), rec(2), rec(3), rec(4), rec(5)];
    const dry = await runImport(db, records, { dryRun: true });
    expect(dry).toMatchObject({ mode: 'dry-run', planned: 5, inserted: 5 });
    expect(await imported()).toBe(0);

    await runImport(db, records, { dryRun: false, limit: 2 });
    expect(await imported()).toBe(2);
    const resumed = await runImport(db, records, { dryRun: false, batchSize: 2 });
    expect(resumed).toMatchObject({ inserted: 3, batches: 2, skipped: { ALREADY_IMPORTED: 2 } });
    expect(await imported()).toBe(5);
  });

  it('istniejące składniki: zajęta nazwa i ten sam kod źródła - pominięte, nic nie zmienione', async () => {
    const apple = await t.prisma.ingredient.findFirstOrThrow({ where: { namePl: 'Jabłko' } });
    const before = { ...apple };
    const report = await runImport(
      db,
      [
        rec(1, { namePl: 'jablko' }),
        rec(2, {
          source: apple.source as 'USDA',
          sourceRef: apple.sourceRef ?? 'x',
          namePl: 'Jabłuszko testowe',
        }),
        rec(3),
      ],
      { dryRun: false },
    );
    expect(report).toMatchObject({
      inserted: 1,
      skipped: { NAME_TAKEN: 1, SAME_SOURCE_REF: apple.sourceRef ? 1 : 0 },
    });
    expect(await t.prisma.ingredient.findUniqueOrThrow({ where: { id: apple.id } })).toEqual(before);
  });

  it('cofnięcie usuwa tylko nieużywane rekordy importu; przepisy i istniejące składniki nietknięte', async () => {
    await runImport(db, [rec(1), rec(2)], { dryRun: false });
    const used = await t.prisma.ingredient.findFirstOrThrow({ where: { seedKey: 'import:usda:t1' } });
    const user = await t.prisma.user.create({
      data: {
        username: `imp${Date.now()}`,
        usernameNormalized: `imp${Date.now()}`,
        email: `imp${Date.now()}@e2e.cookivo.test`,
        passwordHash: 'x',
      },
    });
    const recipe = await t.prisma.recipe.create({
      data: {
        authorId: user.id,
        title: 'Przepis z importu',
        searchText: 'przepis z importu',
        servings: 1,
        ingredients: {
          create: [{ position: 0, ingredientId: used.id, amount: 100, unitCode: 'g', grams: 100 }],
        },
      },
    });
    const total = await t.prisma.ingredient.count();

    const dry = await undoImport(db, true);
    expect(dry).toEqual({ removable: 1, kept: 1 });
    expect(await t.prisma.ingredient.count()).toBe(total);
    await undoImport(db, false);
    expect(await imported()).toBe(1);
    expect(await t.prisma.ingredient.count()).toBe(total - 1);
    expect(await t.prisma.recipeIngredient.count({ where: { recipeId: recipe.id } })).toBe(1);
    await t.prisma.recipe.delete({ where: { id: recipe.id } });
    await t.prisma.user.delete({ where: { id: user.id } });
  });

  it('alergeny typowe (recenzja AI): flaga w API, zapis w formularzu przez admina ją czyści', async () => {
    await runImport(db, [rec(1, { allergensTypical: true, review: ['ZWERYFIKOWANY_AI'] })], {
      dryRun: false,
    });
    const row = await t.prisma.ingredient.findFirstOrThrow({ where: { seedKey: 'import:usda:t1' } });
    const res = await t.api().get(`/api/ingredients/${row.id}`).expect(200);
    expect(res.body.allergensTypical).toBe(true);
    const admin = await t.login('importadmin', { role: 'ADMIN' });
    await t
      .api()
      .patch(`/api/ingredients/${row.id}`)
      .set({ Authorization: `Bearer ${admin}` })
      .send({
        namePl: row.namePl,
        categoryCode: 'VEGETABLES',
        kcal: 40,
        protein: 1,
        fat: 0.2,
        carbs: 8,
        allergens: [],
        units: [],
      })
      .expect(200);
    expect((await t.prisma.ingredient.findUniqueOrThrow({ where: { id: row.id } })).allergensTypical).toBe(
      false,
    );
  });

  it('duży import: 3000 rekordów partiami', async () => {
    const records = Array.from({ length: 3000 }, (_, i) =>
      rec(i + 100, { allergens: i % 2 ? ['MILK'] : [] }),
    );
    const report = await runImport(db, records, { dryRun: false });
    expect(report).toMatchObject({ inserted: 3000, batches: 3 });
    expect(await imported()).toBe(3000);
    expect(
      await t.prisma.ingredientAllergen.count({
        where: { ingredient: { seedKey: { startsWith: 'import:' } } },
      }),
    ).toBe(1500);
    expect(report.ms).toBeLessThan(60_000);
  }, 120_000);
});
