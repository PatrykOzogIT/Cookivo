import { createTestApp } from './support/app.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

interface Item {
  id: string;
  ingredient: { id: string; namePl: string; category: { code: string } } | null;
  name: string | null;
  note: string | null;
  grams: number | null;
  amount: { amount: number; unit: string; grams: number } | null;
  checked: boolean;
  checkedBy: string | null;
}

describe('Lodówka i lista zakupów (e2e)', () => {
  let t: TestApp;
  let me: string;
  let ids: Record<string, string>;
  let soup: string;

  beforeAll(async () => {
    t = await createTestApp();
    const byName = async (namePl: string) =>
      (await t.prisma.ingredient.findFirstOrThrow({ where: { namePl, source: 'USDA' } })).id;
    ids = {
      carrot: await byName('Marchew'),
      egg: await byName('Jajko'),
      flour: await byName('Mąka pszenna'),
    };
  });

  beforeEach(async () => {
    await t.prisma.recipeIngredient.deleteMany();
    await t.prisma.recipe.deleteMany();
    await t.prisma.user.deleteMany();
    await t.prisma.household.deleteMany();
    me = await t.login('kucharz');
    const recipe = async (title: string, ingredients: object[]) =>
      (
        await t
          .api()
          .post('/api/recipes')
          .set(bearer(me))
          .send({
            title,
            servings: 2,
            visibility: 'PRIVATE',
            canBeIngredient: true,
            mealTypes: [],
            ingredients,
            steps: [],
            photoIds: [],
          })
          .expect(201)
      ).body.id as string;
    // Baza: 400 g marchwi na 2 porcje; zupa: cała baza (podprzepis) + 2 jajka
    const base = await recipe('Baza warzywna', [{ ingredientId: ids.carrot, amount: 400, unitCode: 'g' }]);
    soup = await recipe('Zupa', [
      { subRecipeId: base, amount: 2, unitCode: 'SERVING' },
      { ingredientId: ids.egg, amount: 2, unitCode: 'PIECE' },
    ]);
  });

  afterAll(async () => {
    await t.app.close();
  });

  const api = () => t.api();
  const list = async (token = me) =>
    ((await api().get('/api/shopping').set(bearer(token)).expect(200)).body as { items: Item[] }).items;
  const byIngredient = (items: Item[], id: string) => items.find((i) => i.ingredient?.id === id);

  it('z przepisu: rozwija podprzepisy i skaluje porcje; ilości kuchenne', async () => {
    const res = await api()
      .post('/api/shopping/from-recipe')
      .set(bearer(me))
      .send({ recipeId: soup, servings: 4 })
      .expect(201);
    expect(res.body).toEqual({ added: 2, inPantry: [] });
    const items = await list();
    expect(byIngredient(items, ids.carrot)?.grams).toBeCloseTo(800);
    // Marchew ma wagę sztuki: "14 szt. (ok. 800 g)"
    expect(byIngredient(items, ids.carrot)?.amount).toMatchObject({ unit: 'PIECE', grams: 800 });
    expect(byIngredient(items, ids.egg)?.amount).toMatchObject({ unit: 'PIECE', amount: 4 });

    // Drugie dodanie sumuje się z nieodhaczoną pozycją
    await api()
      .post('/api/shopping/from-recipe')
      .set(bearer(me))
      .send({ recipeId: soup, servings: 2 })
      .expect(201);
    expect(byIngredient(await list(), ids.egg)?.amount?.amount).toBe(6);
    expect(await list()).toHaveLength(2);
  });

  it('z planu: partie z zakresu dat, minus lodówka (z ilością i bez)', async () => {
    await api()
      .post('/api/planner/meals')
      .set(bearer(me))
      .send({ date: '2026-10-05', slot: 'DINNER', recipeId: soup, servings: 2, cookServings: 4 })
      .expect(201);
    await api()
      .post('/api/planner/meals')
      .set(bearer(me))
      .send({ date: '2026-10-20', slot: 'DINNER', recipeId: soup, servings: 2 })
      .expect(201);

    // W lodówce: 300 g marchwi i jajka "są" (bez ilości)
    await api()
      .post('/api/pantry')
      .set(bearer(me))
      .send({ ingredientId: ids.carrot, amount: 300, unitCode: 'g' })
      .expect(201);
    await api().post('/api/pantry').set(bearer(me)).send({ ingredientId: ids.egg }).expect(201);

    const res = await api()
      .post('/api/shopping/from-plan')
      .set(bearer(me))
      .send({ from: '2026-10-05', to: '2026-10-11' })
      .expect(201);
    expect(res.body.added).toBe(1);
    expect(res.body.inPantry.map((i: { namePl: string }) => i.namePl)).toEqual(['Jajko']);
    const items = await list();
    expect(items).toHaveLength(1);
    expect(items[0].grams).toBeCloseTo(500); // 800 - 300
  });

  it('własne pozycje, odhaczanie, przeniesienie kupionych do lodówki, czyszczenie', async () => {
    await api()
      .post('/api/shopping/items')
      .set(bearer(me))
      .send({ name: 'Papier do pieczenia', note: '1 rolka' })
      .expect(201);
    const flour = (
      await api()
        .post('/api/shopping/items')
        .set(bearer(me))
        .send({ ingredientId: ids.flour, amount: 1, unitCode: 'g' })
        .expect(201)
    ).body as Item;
    await api()
      .post('/api/shopping/items')
      .set(bearer(me))
      .send({ name: 'x', ingredientId: ids.flour })
      .expect(400);

    const checked = (
      await api().patch(`/api/shopping/items/${flour.id}`).set(bearer(me)).send({ checked: true }).expect(200)
    ).body;
    expect(checked).toMatchObject({ checked: true, checkedBy: 'kucharz' });

    expect((await api().post('/api/shopping/to-pantry').set(bearer(me)).expect(201)).body).toEqual({
      moved: 1,
    });
    const pantry = (await api().get('/api/pantry').set(bearer(me)).expect(200)).body.items;
    expect(pantry).toHaveLength(1);
    expect(pantry[0]).toMatchObject({ ingredient: { namePl: 'Mąka pszenna' }, grams: 1 });

    const items = await list();
    expect(items.map((i) => i.name)).toEqual(['Papier do pieczenia']);
    await api().post('/api/shopping/clear').set(bearer(me)).send({ checkedOnly: false }).expect(204);
    expect(await list()).toEqual([]);
  });

  it('lodówka: ilość w jednostkach kuchennych, ważność, "zużyj wkrótce"', async () => {
    const soon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const item = (
      await api()
        .post('/api/pantry')
        .set(bearer(me))
        .send({ ingredientId: ids.egg, amount: 6, unitCode: 'PIECE', expiresOn: soon })
        .expect(201)
    ).body;
    expect(item).toMatchObject({
      amount: 6,
      unitCode: 'PIECE',
      expiresOn: soon,
      daysLeft: 1,
      expiring: true,
    });
    expect(item.grams).toBeGreaterThan(250);

    // Ponowne dodanie tego samego składnika aktualizuje wpis
    await api().post('/api/pantry').set(bearer(me)).send({ ingredientId: ids.egg }).expect(201);
    const items = (await api().get('/api/pantry').set(bearer(me)).expect(200)).body.items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ amount: null, grams: null });

    const bad = await api()
      .post('/api/pantry')
      .set(bearer(me))
      .send({ ingredientId: ids.carrot, amount: 2, unitCode: 'CAN' })
      .expect(400);
    expect(bad.body.code).toBe('UNIT_NOT_ALLOWED');
  });

  it('gospodarstwo ma wspólną listę i lodówkę; obcy nie widzi', async () => {
    const partner = await t.login('partner');
    await api().post('/api/household').set(bearer(me)).send({ name: 'Dom' }).expect(201);
    const invite = (await api().post('/api/household/invites').set(bearer(me)).send({}).expect(201)).body;
    const token = new URL(invite.url).searchParams.get('token');
    await api().post('/api/household/join').set(bearer(partner)).send({ token }).expect(201);

    const item = (await api().post('/api/shopping/items').set(bearer(me)).send({ name: 'Kawa' }).expect(201))
      .body as Item;
    await api()
      .patch(`/api/shopping/items/${item.id}`)
      .set(bearer(partner))
      .send({ checked: true })
      .expect(200);
    expect((await list(me))[0]).toMatchObject({ name: 'Kawa', checked: true, checkedBy: 'partner' });

    const obcy = await t.login('obcy');
    expect(await list(obcy)).toEqual([]);
    await api().delete(`/api/shopping/items/${item.id}`).set(bearer(obcy)).expect(404);
  });

  it('sortowanie przepisów "najpierw z tego, co mam"', async () => {
    const egg = (
      await api()
        .post('/api/recipes')
        .set(bearer(me))
        .send({
          title: 'Jajecznica',
          servings: 1,
          visibility: 'PRIVATE',
          canBeIngredient: false,
          mealTypes: [],
          ingredients: [{ ingredientId: ids.egg, amount: 3, unitCode: 'PIECE' }],
          steps: [],
          photoIds: [],
        })
        .expect(201)
    ).body.id;
    await api().post('/api/pantry').set(bearer(me)).send({ ingredientId: ids.egg }).expect(201);
    const res = await api().get('/api/recipes?mine=true&sort=fromPantry').set(bearer(me)).expect(200);
    expect(res.body.items[0].id).toBe(egg);
  });
});
