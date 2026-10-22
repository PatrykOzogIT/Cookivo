import type { PrismaClient } from '../src/generated/prisma/client.js';
import { SYSTEM_USERNAME, runImport, undoImport } from '../prisma/recipes-import/lib/importer.js';
import type { RecipeRecord } from '../prisma/recipes-import/lib/record.js';
import { createTestApp } from './support/app.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const PHOTO = {
  id: '019a0000-0000-7000-8000-000000000001',
  file: 'Placki.jpg',
  thumbUrl: 'https://upload.wikimedia.org/x.jpg',
  width: 1600,
  height: 1200,
  bytes: 300000,
  author: 'Jan Kowalski',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Placki.jpg',
};

const rec = (n: number, over: Partial<RecipeRecord> = {}): RecipeRecord => ({
  key: `wikibooks-pl:9000${n}#1`,
  wiki: 'pl',
  revId: 100 + n,
  course: 'MAIN',
  views: 10,
  title: `Placki biblioteczne ${n}`,
  description: 'Placki z ziemniaków.',
  servings: 4,
  servingsEstimated: false,
  prepMinutes: 20,
  cookMinutes: 15,
  difficulty: 'EASY',
  mealTypes: ['DINNER'],
  ingredients: [
    { ingredient: 'Ziemniaki', amount: 1000, unitCode: 'g', groupName: 'Ciasto', note: 'starte' },
    { ingredient: 'Jajko', amount: 2, unitCode: 'PIECE', groupName: 'Ciasto', note: null },
    { ingredient: 'Mąka pszenna', amount: 3, unitCode: 'TABLESPOON', groupName: null, note: null },
  ],
  steps: [
    { text: 'Zetrzeć ziemniaki.', timerMinutes: null },
    { text: 'Smażyć z obu stron.', timerMinutes: 5 },
  ],
  translation: {
    locale: 'en',
    title: `Library potato pancakes ${n}`,
    description: 'Potato pancakes.',
    steps: ['Grate the potatoes.', 'Fry on both sides.'],
    lines: [
      { groupName: 'Batter', note: 'grated' },
      { groupName: 'Batter', note: null },
      { groupName: null, note: null },
    ],
  },
  source: {
    sourceName: 'Wikibooks',
    sourceLocale: 'pl',
    sourceTitle: `Książka kucharska/Placki ${n}`,
    url: `https://pl.wikibooks.org/wiki/Ksi%C4%85%C5%BCka_kucharska/Placki_${n}`,
    historyUrl: `https://pl.wikibooks.org/w/index.php?title=Placki_${n}&action=history`,
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    changes: ['RESTRUCTURED'],
    datasetVersion: 'test',
  },
  photo: null,
  ...over,
});

describe('Biblioteka przepisów - import (e2e)', () => {
  let t: TestApp;
  let prisma: PrismaClient;

  const cleanup = async () => {
    const ids = (await t.prisma.recipeSource.findMany({ select: { recipeId: true } })).map((s) => s.recipeId);
    await t.prisma.recipe.deleteMany({ where: { OR: [{ id: { in: ids } }, { variantOfId: { in: ids } }] } });
    await t.prisma.recipe.deleteMany({ where: { title: { startsWith: 'Placki biblioteczne' } } });
  };

  beforeAll(async () => {
    t = await createTestApp();
    prisma = t.prisma as unknown as PrismaClient;
  });
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await t.app.close();
  });

  const imported = () => t.prisma.recipeSource.count();

  it('dry run nic nie zapisuje; import tworzy publiczny przepis konta Cookivo, ponowny niczego nie dubluje', async () => {
    const records = [rec(1, { photo: PHOTO }), rec(2)];
    const dry = await runImport(prisma, records, { dryRun: true });
    expect(dry).toMatchObject({ mode: 'dry-run', planned: 2, inserted: 2 });
    expect(await imported()).toBe(0);

    expect(await runImport(prisma, records, { dryRun: false })).toMatchObject({ inserted: 2 });
    const src = await t.prisma.recipeSource.findUniqueOrThrow({
      where: { externalId: 'wikibooks-pl:90001#1' },
      include: { recipe: { include: { author: true, photos: true, translations: true } } },
    });
    expect(src.recipe).toMatchObject({
      visibility: 'PUBLIC',
      searchText: 'placki biblioteczne 1 library potato pancakes 1',
      author: { username: SYSTEM_USERNAME },
    });
    // Wartości liczone z bazy składników
    expect(src.recipe.kcal).toBeGreaterThan(500);
    expect(src.recipe.photos[0]).toMatchObject({ id: PHOTO.id, creditAuthor: 'Jan Kowalski', position: 0 });
    expect(src.recipe.translations).toHaveLength(1);

    const again = await runImport(prisma, records, { dryRun: false });
    expect(again).toMatchObject({ planned: 0, skipped: { ALREADY_IMPORTED: 2 } });
    expect(await imported()).toBe(2);
  });

  it('brak składnika, jednostki albo ten sam tytuł - pominięte z powodem', async () => {
    await t.prisma.recipe.create({
      data: {
        authorId: (await t.prisma.user.findFirstOrThrow()).id,
        title: 'Placki biblioteczne 3',
        searchText: 'placki biblioteczne 3',
        servings: 2,
        visibility: 'PUBLIC',
      },
    });
    const report = await runImport(
      prisma,
      [
        rec(3),
        rec(4, {
          ingredients: [
            { ingredient: 'Nieistniejący składnik', amount: 1, unitCode: 'g', groupName: null, note: null },
          ],
        }),
        rec(5, {
          ingredients: [{ ingredient: 'Jajko', amount: 1, unitCode: 'GLASS', groupName: null, note: null }],
        }),
      ],
      { dryRun: false },
    );
    expect(report).toMatchObject({
      inserted: 0,
      skipped: { DUPLICATE_TITLE: 1, INGREDIENT_MISSING: 1, UNIT_NOT_ALLOWED: 1 },
    });
  });

  it('API: treść w języku czytającego, źródło i licencja, podpis zdjęcia, wyszukiwanie po angielsku', async () => {
    await runImport(prisma, [rec(6, { photo: { ...PHOTO, ...photoOf(6) } })], { dryRun: false });
    const { recipeId } = await t.prisma.recipeSource.findUniqueOrThrow({
      where: { externalId: 'wikibooks-pl:90006#1' },
    });

    const pl = (await t.api().get(`/api/recipes/${recipeId}`).expect(200)).body;
    expect(pl).toMatchObject({ title: 'Placki biblioteczne 6', steps: [{ text: 'Zetrzeć ziemniaki.' }, {}] });
    expect(pl.ingredients[0]).toMatchObject({ groupName: 'Ciasto', note: 'starte' });
    expect(pl.source).toMatchObject({
      name: 'Wikibooks',
      license: 'CC BY-SA 4.0',
      adapted: false,
      locale: 'pl',
    });
    expect(pl.photos[0].credit).toEqual({
      author: 'Jan Kowalski',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Placki6.jpg',
    });

    const en = (await t.api().get(`/api/recipes/${recipeId}?lang=en`).expect(200)).body;
    expect(en).toMatchObject({ title: 'Library potato pancakes 6', description: 'Potato pancakes.' });
    expect(en.steps.map((s: { text: string }) => s.text)).toEqual([
      'Grate the potatoes.',
      'Fry on both sides.',
    ]);
    expect(en.ingredients[0]).toMatchObject({ groupName: 'Batter', note: 'grated' });

    const list = (await t.api().get('/api/recipes?q=library potato&lang=en').expect(200)).body;
    expect(list.items.map((i: { title: string }) => i.title)).toContain('Library potato pancakes 6');
    const listPl = (await t.api().get('/api/recipes?q=library potato&lang=pl').expect(200)).body;
    expect(listPl.items.map((i: { title: string }) => i.title)).toContain('Placki biblioteczne 6');
  });

  it('własna wersja ma źródło oryginału (utwór zależny) i jego tłumaczenia; edycja usuwa tłumaczenia', async () => {
    await runImport(prisma, [rec(7)], { dryRun: false });
    const { recipeId } = await t.prisma.recipeSource.findUniqueOrThrow({
      where: { externalId: 'wikibooks-pl:90007#1' },
    });
    const token = await t.login('libraryfan');
    const auth = { Authorization: `Bearer ${token}` };
    const variant = (await t.api().post(`/api/recipes/${recipeId}/variant`).set(auth).expect(201)).body;
    expect(variant.source).toMatchObject({ name: 'Wikibooks', adapted: true });
    const en = (await t.api().get(`/api/recipes/${variant.id}?lang=en`).set(auth).expect(200)).body;
    expect(en.title).toBe('Library potato pancakes 7');

    const form = (await t.api().get(`/api/recipes/${variant.id}`).set(auth).expect(200)).body;
    await t
      .api()
      .patch(`/api/recipes/${variant.id}`)
      .set(auth)
      .send({
        title: 'Moje placki',
        servings: 4,
        visibility: 'PRIVATE',
        mealTypes: [],
        groupIds: [],
        canBeIngredient: false,
        ingredients: form.ingredients.map(
          (l: { ingredient: { id: string }; amount: number; unitCode: string }) => ({
            ingredientId: l.ingredient.id,
            amount: l.amount,
            unitCode: l.unitCode,
          }),
        ),
        steps: [{ text: 'Usmażyć.' }],
        photoIds: [],
      })
      .expect(200);
    expect(await t.prisma.recipeTranslation.count({ where: { recipeId: variant.id } })).toBe(0);
    const after = (await t.api().get(`/api/recipes/${variant.id}?lang=en`).set(auth).expect(200)).body;
    expect(after.title).toBe('Moje placki');
  });

  it('cofnięcie usuwa tylko nieużywane przepisy z biblioteki', async () => {
    await runImport(prisma, [rec(8), rec(9)], { dryRun: false });
    const used = await t.prisma.recipeSource.findUniqueOrThrow({
      where: { externalId: 'wikibooks-pl:90008#1' },
    });
    const rater = await t.prisma.user.findFirstOrThrow({ where: { NOT: { username: SYSTEM_USERNAME } } });
    await t.prisma.recipeRating.create({ data: { recipeId: used.recipeId, userId: rater.id, stars: 5 } });
    expect(await undoImport(prisma, true)).toEqual({ removable: 1, kept: 1 });
    expect(await imported()).toBe(2);
    await undoImport(prisma, false);
    expect(await imported()).toBe(1);
    await t.prisma.recipeRating.deleteMany({ where: { recipeId: used.recipeId } });
  });
});

function photoOf(n: number) {
  return {
    id: `019a0000-0000-7000-8000-00000000000${n}`,
    sourceUrl: `https://commons.wikimedia.org/wiki/File:Placki${n}.jpg`,
  };
}
