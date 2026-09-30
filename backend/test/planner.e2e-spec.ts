import { createTestApp } from './support/app.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

interface PlanMeal {
  id: string;
  date: string;
  slot: string;
  servings: number;
  myServings: number;
  fromLeftovers: boolean;
  stale: boolean;
  cook: { id: string; date: string; servings: number; remaining: number };
  recipe: { title: string; perServing: { kcal: number } };
}

describe('Planer (e2e)', () => {
  let t: TestApp;
  let me: string;
  let soup: string;
  let omelette: string;

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await t.prisma.recipeIngredient.deleteMany();
    await t.prisma.recipe.deleteMany();
    await t.prisma.user.deleteMany();
    await t.prisma.household.deleteMany();
    me = await t.login('kucharz');
    const carrot = (
      await t.prisma.ingredient.findFirstOrThrow({ where: { namePl: 'Marchew', source: 'USDA' } })
    ).id;
    const egg = (await t.prisma.ingredient.findFirstOrThrow({ where: { namePl: 'Jajko', source: 'USDA' } }))
      .id;
    const create = async (title: string, ingredientId: string, amount: number, unitCode: string) =>
      (
        await t
          .api()
          .post('/api/recipes')
          .set(bearer(me))
          .send({
            title,
            servings: 4,
            visibility: 'PRIVATE',
            canBeIngredient: false,
            mealTypes: [],
            ingredients: [{ ingredientId, amount, unitCode }],
            steps: [],
            photoIds: [],
          })
          .expect(201)
      ).body.id as string;
    soup = await create('Zupa marchewkowa', carrot, 800, 'g');
    omelette = await create('Omlet', egg, 4, 'PIECE');
  });

  afterAll(async () => {
    await t.app.close();
  });

  const api = () => t.api();
  const week = async (token = me, from = '2026-10-05', to = '2026-10-11') =>
    (await api().get('/api/planner').query({ from, to }).set(bearer(token)).expect(200)).body as {
      meals: PlanMeal[];
      leftovers: { cookId: string; remaining: number }[];
      slots: { key: string; hidden: boolean; name: string | null }[];
      people: number;
      settings: { hiddenSlots: string[] };
    };
  const add = (body: object, token = me) => api().post('/api/planner/meals').set(bearer(token)).send(body);

  it('pusty tydzień: stałe posiłki, brak dań', async () => {
    const w = await week();
    expect(w.slots.map((s) => s.key)).toEqual([
      'BREAKFAST',
      'SECOND_BREAKFAST',
      'DINNER',
      'AFTERNOON_SNACK',
      'SUPPER',
      'SNACK',
    ]);
    expect(w.meals).toEqual([]);
    expect(w.people).toBe(1);
  });

  it('gotowanie na zapas: 4 porcje w poniedziałek, 2 zjedzone, 2 na wtorek', async () => {
    await add({ date: '2026-10-05', slot: 'DINNER', recipeId: soup, servings: 2, cookServings: 4 }).expect(
      201,
    );
    let w = await week();
    expect(w.leftovers).toHaveLength(1);
    expect(w.leftovers[0].remaining).toBe(2);

    await add({ date: '2026-10-06', slot: 'DINNER', cookId: w.leftovers[0].cookId, servings: 2 }).expect(201);
    w = await week();
    expect(w.leftovers).toHaveLength(0);
    const tuesday = w.meals.find((m) => m.date === '2026-10-06')!;
    expect(tuesday).toMatchObject({
      fromLeftovers: true,
      stale: false,
      cook: { date: '2026-10-05', remaining: 0 },
    });

    // Więcej niż zostało - odmowa
    const res = await add({
      date: '2026-10-07',
      slot: 'DINNER',
      cookId: tuesday.cook.id,
      servings: 1,
    }).expect(409);
    expect(res.body.code).toBe('PORTIONS_EXCEEDED');
  });

  it('ostrzeżenie o świeżości po 3 dniach', async () => {
    await add({ date: '2026-10-05', slot: 'DINNER', recipeId: soup, servings: 1, cookServings: 3 }).expect(
      201,
    );
    const cookId = (await week()).leftovers[0].cookId;
    await add({ date: '2026-10-08', slot: 'SUPPER', cookId, servings: 1 }).expect(201);
    await add({ date: '2026-10-09', slot: 'SUPPER', cookId, servings: 1 }).expect(201);
    const w = await week();
    expect(w.meals.find((m) => m.date === '2026-10-08')!.stale).toBe(false);
    expect(w.meals.find((m) => m.date === '2026-10-09')!.stale).toBe(true);
  });

  it('zwykły posiłek: zmiana porcji zmienia gotowanie; przeniesienie; usunięcie', async () => {
    const { id } = (
      await add({ date: '2026-10-05', slot: 'BREAKFAST', recipeId: omelette, servings: 1 }).expect(201)
    ).body;
    await api().patch(`/api/planner/meals/${id}`).set(bearer(me)).send({ servings: 2 }).expect(204);
    let meal = (await week()).meals[0];
    expect(meal).toMatchObject({ servings: 2, cook: { servings: 2, remaining: 0 } });

    await api()
      .patch(`/api/planner/meals/${id}`)
      .set(bearer(me))
      .send({ date: '2026-10-07', slot: 'SUPPER' })
      .expect(204);
    meal = (await week()).meals[0];
    expect(meal).toMatchObject({ date: '2026-10-07', slot: 'SUPPER', cook: { date: '2026-10-07' } });

    await api().delete(`/api/planner/meals/${id}`).set(bearer(me)).expect(204);
    expect((await week()).meals).toEqual([]);
    expect(await t.prisma.planCook.count()).toBe(0);
  });

  it('kopiowanie tygodnia i czyszczenie', async () => {
    await add({ date: '2026-10-05', slot: 'DINNER', recipeId: soup, servings: 2, cookServings: 4 }).expect(
      201,
    );
    const cookId = (await week()).leftovers[0].cookId;
    await add({ date: '2026-10-06', slot: 'DINNER', cookId, servings: 2 }).expect(201);

    await api()
      .post('/api/planner/copy')
      .set(bearer(me))
      .send({ from: '2026-10-05', to: '2026-10-12', days: 7 })
      .expect(201);
    const next = await week(me, '2026-10-12', '2026-10-18');
    expect(next.meals.map((m) => m.date)).toEqual(['2026-10-12', '2026-10-13']);
    expect(next.meals[1]).toMatchObject({ fromLeftovers: true, cook: { servings: 4, remaining: 0 } });

    await api()
      .delete('/api/planner')
      .query({ from: '2026-10-05', to: '2026-10-11' })
      .set(bearer(me))
      .expect(204);
    expect((await week()).meals).toEqual([]);
    expect((await week(me, '2026-10-12', '2026-10-18')).meals).toHaveLength(2);
  });

  it('ustawienia: ukryte posiłki i własny posiłek', async () => {
    await api()
      .put('/api/planner/settings')
      .set(bearer(me))
      .send({ hiddenSlots: ['SECOND_BREAKFAST', 'AFTERNOON_SNACK'] })
      .expect(200);
    const slot = (
      await api().post('/api/planner/slots').set(bearer(me)).send({ name: 'Po treningu' }).expect(201)
    ).body;
    await add({ date: '2026-10-05', slot: slot.key, recipeId: omelette, servings: 1 }).expect(201);

    let w = await week();
    expect(w.slots.filter((s) => s.hidden).map((s) => s.key)).toEqual([
      'SECOND_BREAKFAST',
      'AFTERNOON_SNACK',
    ]);
    expect(w.slots.at(-1)).toMatchObject({ name: 'Po treningu' });
    expect(w.meals[0].slot).toBe(slot.key);

    // Usunięcie własnego posiłku usuwa też zaplanowane w nim dania
    await api().delete(`/api/planner/slots/${slot.key}`).set(bearer(me)).expect(204);
    w = await week();
    expect(w.meals).toEqual([]);
    const bad = await add({ date: '2026-10-05', slot: 'KOLACJA', recipeId: omelette, servings: 1 }).expect(
      400,
    );
    expect(bad.body.code).toBe('SLOT_UNKNOWN');
  });

  it('gospodarstwo ma wspólny plan; porcje dzielone równo w trybie prostym', async () => {
    const partner = await t.login('partner');
    await api().post('/api/household').set(bearer(me)).send({ name: 'Dom' }).expect(201);
    const invite = (await api().post('/api/household/invites').set(bearer(me)).send({}).expect(201)).body;
    const token = new URL(invite.url).searchParams.get('token');
    await api().post('/api/household/join').set(bearer(partner)).send({ token }).expect(201);

    await add({ date: '2026-10-05', slot: 'DINNER', recipeId: soup, servings: 2 }).expect(201);
    const theirs = await week(partner);
    expect(theirs.people).toBe(2);
    expect(theirs.meals[0]).toMatchObject({ servings: 2, myServings: 1 });

    // Prywatny przepis kucharza jest w planie widoczny, ale partner nie doda go sam
    await add({ date: '2026-10-06', slot: 'DINNER', recipeId: soup, servings: 2 }, partner).expect(404);
  });

  it('osobisty plan jest w eksporcie danych', async () => {
    await add({ date: '2026-10-05', slot: 'DINNER', recipeId: soup, servings: 1 }).expect(201);
    const exported = (await api().get('/api/me/export').set(bearer(me)).expect(200)).body;
    expect(exported.planner.meals).toEqual([
      { date: '2026-10-05', meal: 'DINNER', recipe: 'Zupa marchewkowa', servings: 1, cookedOn: '2026-10-05' },
    ]);
  });

  it('cudzego posiłku nie zmienię; zły zakres dat', async () => {
    const { id } = (
      await add({ date: '2026-10-05', slot: 'DINNER', recipeId: soup, servings: 1 }).expect(201)
    ).body;
    const obcy = await t.login('obcy');
    await api().patch(`/api/planner/meals/${id}`).set(bearer(obcy)).send({ servings: 3 }).expect(404);
    await api().delete(`/api/planner/meals/${id}`).set(bearer(obcy)).expect(404);
    await api()
      .get('/api/planner')
      .query({ from: '2026-10-11', to: '2026-10-05' })
      .set(bearer(me))
      .expect(400);
    await api()
      .get('/api/planner')
      .query({ from: '2026-02-30', to: '2026-03-05' })
      .set(bearer(me))
      .expect(400);
  });
});
