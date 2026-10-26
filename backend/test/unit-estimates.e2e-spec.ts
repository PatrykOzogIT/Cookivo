import { UnitEstimator } from '../src/unit-estimates/unit-estimator.js';
import { createTestApp } from './support/app.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Miary kuchenne: szacunek AI i propozycje (e2e)', () => {
  let t: TestApp;
  let estimator: UnitEstimator;
  let cook: string;
  let other: string;
  let admin: string;
  let groatsId: string;
  let categoryId: number;

  beforeAll(async () => {
    t = await createTestApp();
    estimator = t.app.get(UnitEstimator);
    cook = await t.login('kucharz_miar');
    other = await t.login('drugi_kucharz');
    admin = await t.login('szefowa_miar', { role: 'ADMIN' });
    categoryId = (await t.prisma.ingredientCategory.findUniqueOrThrow({ where: { code: 'GRAINS' } })).id;
  });

  beforeEach(async () => {
    estimator.enabled = true;
    await t.prisma.aiImport.deleteMany({ where: { kind: 'UNIT_ESTIMATE' } });
    await t.prisma.recipe.deleteMany({ where: { title: { startsWith: 'Miary test' } } });
    await t.prisma.ingredient.deleteMany({ where: { namePl: { startsWith: 'Kasza testowa' } } });
    const groats = await t.prisma.ingredient.create({
      data: {
        namePl: 'Kasza testowa jaglana',
        nameEn: 'Test millet',
        searchText: 'kasza testowa jaglana test millet',
        categoryId,
        status: 'APPROVED',
        kcal: 350,
        protein: 11,
        fat: 4,
        carbs: 70,
      },
    });
    groatsId = groats.id;
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    await t.prisma.recipe.deleteMany({ where: { title: { startsWith: 'Miary test' } } });
    await t.prisma.ingredient.deleteMany({ where: { namePl: { startsWith: 'Kasza testowa' } } });
    await t.app.close();
  });

  const estimate = (token: string, code: string) =>
    t.api().post(`/api/ingredients/${groatsId}/units/${code}/estimate`).set(bearer(token)).expect(200);

  it('szacunek AI zapisuje się dla wszystkich (oznaczony), kolejne pytanie już bez AI', async () => {
    const spy = vi.spyOn(estimator, 'estimate').mockResolvedValue({
      estimate: { TEASPOON: 4.5, TABLESPOON: 13, GLASS: 210, PINCH: null, PIECE: null },
      inputTokens: 100,
      outputTokens: 20,
    });
    expect((await estimate(cook, 'TEASPOON')).body).toEqual({ status: 'KNOWN', grams: 4.5, basis: 'AI' });
    expect(spy).toHaveBeenCalledTimes(1);

    // Inna osoba, inna miara tego samego składnika - z bazy, bez wywołania AI
    expect((await estimate(other, 'GLASS')).body).toEqual({ status: 'KNOWN', grams: 210, basis: 'AI' });
    // Miara, która nie pasuje (sztuka kaszy)
    expect((await estimate(other, 'PIECE')).body).toEqual({ status: 'NOT_FIT' });
    expect(spy).toHaveBeenCalledTimes(1);

    const card = (await t.api().get(`/api/ingredients/${groatsId}`).expect(200)).body;
    expect(card.units).toContainEqual(expect.objectContaining({ code: 'TEASPOON', grams: 4.5, basis: 'AI' }));
    spy.mockRestore();
  });

  it('wynik spoza zakresu nie jest zapisywany - formularz pyta autora; bez AI też pyta', async () => {
    vi.spyOn(estimator, 'estimate').mockResolvedValueOnce({
      estimate: { TEASPOON: 5000, TABLESPOON: null, GLASS: null, PINCH: null, PIECE: null },
      inputTokens: 1,
      outputTokens: 1,
    });
    expect((await estimate(cook, 'TEASPOON')).body).toEqual({ status: 'ASK', range: [0.5, 15] });
    expect(await t.prisma.ingredientUnit.count({ where: { ingredientId: groatsId } })).toBe(0);

    await t.prisma.ingredient.update({
      where: { id: groatsId },
      data: { unitsEstimatedAt: null, unitsNotFit: [] },
    });
    estimator.enabled = false;
    expect((await estimate(cook, 'TABLESPOON')).body).toEqual({
      status: 'ASK',
      range: [1.5, 45],
      reason: 'DISABLED',
    });
  });

  it('waga od autora działa tylko w jego przepisie; admin zatwierdza ją dla wszystkich i przelicza przepis', async () => {
    estimator.enabled = false;
    const recipe = (unitGrams?: number) => ({
      title: 'Miary test kasza',
      servings: 2,
      visibility: 'PRIVATE',
      mealTypes: [],
      groupIds: [],
      canBeIngredient: false,
      ingredients: [
        { ingredientId: groatsId, amount: 2, unitCode: 'TEASPOON', ...(unitGrams ? { unitGrams } : {}) },
      ],
      steps: [{ text: 'Ugotować.' }],
      photoIds: [],
    });
    // Bez wagi - nie da się przeliczyć; waga spoza zakresu - błąd z pozycją
    await t.api().post('/api/recipes').set(bearer(cook)).send(recipe()).expect(400);
    const bad = await t.api().post('/api/recipes').set(bearer(cook)).send(recipe(5000)).expect(400);
    expect(bad.body).toMatchObject({ code: 'UNIT_GRAMS_INVALID', index: 0 });

    const created = (await t.api().post('/api/recipes').set(bearer(cook)).send(recipe(5)).expect(201)).body;
    expect(created.ingredients[0]).toMatchObject({ unitCode: 'TEASPOON', unitGrams: 5, grams: 10 });
    // Składnik nadal nie zna miary - waga tylko w tym przepisie
    expect(await t.prisma.ingredientUnit.count({ where: { ingredientId: groatsId } })).toBe(0);

    const queue = (await t.api().get('/api/admin/units/suggestions').set(bearer(admin)).expect(200)).body;
    const s = queue.find((x: { ingredient: { id: string } }) => x.ingredient.id === groatsId);
    expect(s).toMatchObject({ grams: 5, unit: { code: 'TEASPOON' }, username: 'kucharz_miar' });
    const summary = (await t.api().get('/api/admin/summary').set(bearer(admin)).expect(200)).body;
    expect(summary.unitSuggestions).toBeGreaterThanOrEqual(1);

    // Zwykły użytkownik nie zatwierdza
    await t.api().post(`/api/admin/units/suggestions/${s.id}/approve`).set(bearer(cook)).send({}).expect(403);
    await t
      .api()
      .post(`/api/admin/units/suggestions/${s.id}/approve`)
      .set(bearer(admin))
      .send({ grams: 4 })
      .expect(204);

    const unit = await t.prisma.ingredientUnit.findUniqueOrThrow({
      where: { ingredientId_unitCode: { ingredientId: groatsId, unitCode: 'TEASPOON' } },
    });
    expect(unit).toMatchObject({ grams: 4, basis: 'ADMIN' });
    const after = (await t.api().get(`/api/recipes/${created.id}`).set(bearer(cook)).expect(200)).body;
    // Przepis liczy się już z wagi dla wszystkich (2 × 4 g), własna waga autora wyczyszczona
    expect(after.ingredients[0]).toMatchObject({ unitGrams: null, grams: 8 });
    expect(await t.prisma.unitSuggestion.count({ where: { id: s.id, status: 'APPROVED' } })).toBe(1);
  });

  it('limit dzienny: po wyczerpaniu formularz pyta autora (bez wywołania AI)', async () => {
    const spy = vi.spyOn(estimator, 'estimate');
    const user = await t.prisma.user.findFirstOrThrow({ where: { username: 'drugi_kucharz' } });
    await t.prisma.aiImport.createMany({
      data: Array.from({ length: 20 }, () => ({
        userId: user.id,
        kind: 'UNIT_ESTIMATE' as const,
        photos: 0,
      })),
    });
    expect((await estimate(other, 'TEASPOON')).body).toEqual({
      status: 'ASK',
      range: [0.5, 15],
      reason: 'LIMIT',
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('admin poprawia szacunek AI - waga sprawdzona', async () => {
    await t.prisma.ingredientUnit.create({
      data: { ingredientId: groatsId, unitCode: 'GLASS', grams: 300, basis: 'AI' },
    });
    const list = (
      await t.api().get('/api/admin/units/estimates?q=kasza testowa').set(bearer(admin)).expect(200)
    ).body;
    expect(list.items).toContainEqual(
      expect.objectContaining({ grams: 300, unit: expect.objectContaining({ code: 'GLASS' }) }),
    );
    await t
      .api()
      .put(`/api/admin/units/${groatsId}/GLASS`)
      .set(bearer(admin))
      .send({ grams: 9999 })
      .expect(400);
    await t
      .api()
      .put(`/api/admin/units/${groatsId}/GLASS`)
      .set(bearer(admin))
      .send({ grams: 200 })
      .expect(204);
    expect(
      await t.prisma.ingredientUnit.findUniqueOrThrow({
        where: { ingredientId_unitCode: { ingredientId: groatsId, unitCode: 'GLASS' } },
      }),
    ).toMatchObject({ grams: 200, basis: 'ADMIN' });
  });
});
