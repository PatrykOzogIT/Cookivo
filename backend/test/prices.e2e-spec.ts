import { createTestApp } from './support/app.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

interface PriceList {
  id: string;
  name: string;
  currency: string;
  isDefault: boolean;
  entries: number;
}

describe('Cenniki i koszty (e2e)', () => {
  let t: TestApp;
  let me: string;
  let ids: Record<string, string>;
  let pancakes: string;

  beforeAll(async () => {
    t = await createTestApp();
    const byName = async (namePl: string) =>
      (await t.prisma.ingredient.findFirstOrThrow({ where: { namePl, source: 'USDA' } })).id;
    ids = {
      flour: await byName('Mąka pszenna'),
      egg: await byName('Jajko'),
      carrot: await byName('Marchew'),
    };
  });

  beforeEach(async () => {
    await t.prisma.recipeIngredient.deleteMany();
    await t.prisma.recipe.deleteMany();
    await t.prisma.user.deleteMany();
    await t.prisma.household.deleteMany();
    me = await t.login('kucharz');
    // Placki na 4 porcje: 500 g mąki i 4 jajka
    pancakes = (
      await t
        .api()
        .post('/api/recipes')
        .set(bearer(me))
        .send({
          title: 'Placki',
          servings: 4,
          visibility: 'PRIVATE',
          canBeIngredient: false,
          mealTypes: [],
          ingredients: [
            { ingredientId: ids.flour, amount: 500, unitCode: 'g' },
            { ingredientId: ids.egg, amount: 4, unitCode: 'PIECE' },
          ],
          steps: [],
          photoIds: [],
        })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await t.app.close();
  });

  const api = () => t.api();
  const lists = async () =>
    ((await api().get('/api/prices').set(bearer(me)).expect(200)).body as { lists: PriceList[] }).lists;

  async function priceList() {
    const created = (await api().post('/api/prices').set(bearer(me)).send({ name: 'Sklep' }).expect(201)).body
      .lists[0] as PriceList;
    // Mąka 1 kg - 4,00 zł; jajka 10 szt. - 12,00 zł
    await api()
      .put(`/api/prices/${created.id}/entries`)
      .set(bearer(me))
      .send({ ingredientId: ids.flour, packageAmount: 1, packageUnitCode: 'kg', price: 4 })
      .expect(200);
    await api()
      .put(`/api/prices/${created.id}/entries`)
      .set(bearer(me))
      .send({ ingredientId: ids.egg, packageAmount: 10, packageUnitCode: 'PIECE', price: 12 })
      .expect(200);
    return created;
  }

  it('cenniki: pierwszy domyślny, zmiana domyślnego, usunięcie przekazuje rolę', async () => {
    await api().post('/api/prices').set(bearer(me)).send({ name: 'Biedronka' }).expect(201);
    await api().post('/api/prices').set(bearer(me)).send({ name: 'Rynek', currency: 'EUR' }).expect(201);
    let all = await lists();
    expect(all.map((l) => [l.name, l.isDefault])).toEqual([
      ['Biedronka', true],
      ['Rynek', false],
    ]);
    const rynek = all.find((l) => l.name === 'Rynek')!;
    await api().patch(`/api/prices/${rynek.id}`).set(bearer(me)).send({ isDefault: true }).expect(200);
    all = await lists();
    expect(all[0]).toMatchObject({ name: 'Rynek', isDefault: true, currency: 'EUR' });
    await api().delete(`/api/prices/${rynek.id}`).set(bearer(me)).expect(200);
    expect((await lists())[0]).toMatchObject({ name: 'Biedronka', isDefault: true });
  });

  it('ceny za opakowanie i ceny jednostkowe', async () => {
    const list = await priceList();
    const res = (await api().get(`/api/prices/${list.id}/entries`).set(bearer(me)).expect(200)).body;
    const flour = res.entries.find((e: { ingredient: { id: string } }) => e.ingredient.id === ids.flour);
    const egg = res.entries.find((e: { ingredient: { id: string } }) => e.ingredient.id === ids.egg);
    expect(flour).toMatchObject({
      packageAmount: 1,
      packageUnitCode: 'kg',
      priceCents: 400,
      unitPrice: { cents: 400, per: 'kg' },
    });
    expect(egg).toMatchObject({ priceCents: 1200, unitPrice: { cents: 120, per: 'PIECE' } });

    // Zmiana ceny nadpisuje wpis; zła jednostka - błąd
    await api()
      .put(`/api/prices/${list.id}/entries`)
      .set(bearer(me))
      .send({ ingredientId: ids.flour, packageAmount: 2, packageUnitCode: 'kg', price: 7 })
      .expect(200);
    const bad = await api()
      .put(`/api/prices/${list.id}/entries`)
      .set(bearer(me))
      .send({ ingredientId: ids.flour, packageAmount: 1, packageUnitCode: 'CAN', price: 3 })
      .expect(400);
    expect(bad.body.code).toBe('UNIT_NOT_ALLOWED');
    expect((await lists())[0].entries).toBe(2);
  });

  it('koszt przepisu: całość i porcja; bez cennika - brak kosztu', async () => {
    expect(
      (await api().get(`/api/recipes/${pancakes}/cost?servings=4`).set(bearer(me)).expect(200)).body,
    ).toEqual({ cost: null });

    await priceList();
    const { cost } = (await api().get(`/api/recipes/${pancakes}/cost?servings=8`).set(bearer(me)).expect(200))
      .body;
    // 1 kg mąki (4,00 zł) + 8 jajek (9,60 zł)
    expect(cost).toMatchObject({
      currency: 'PLN',
      listName: 'Sklep',
      cents: 1360,
      perServingCents: 170,
      missing: [],
    });
  });

  it('koszt listy zakupów i tygodnia w planerze; brakujące ceny', async () => {
    await priceList();
    await api()
      .post('/api/shopping/from-recipe')
      .set(bearer(me))
      .send({ recipeId: pancakes, servings: 4 })
      .expect(201);
    await api()
      .post('/api/shopping/items')
      .set(bearer(me))
      .send({ ingredientId: ids.carrot, amount: 300, unitCode: 'g' })
      .expect(201);
    const shopping = (await api().get('/api/shopping').set(bearer(me)).expect(200)).body;
    // 500 g mąki (2,00 zł) + 4 jajka (4,80 zł); marchew bez ceny
    expect(shopping.cost).toMatchObject({ cents: 680, priced: 2, missing: 1 });
    const carrot = shopping.items.find(
      (i: { ingredient: { id: string } }) => i.ingredient?.id === ids.carrot,
    );
    expect(carrot.costCents).toBeNull();

    await api()
      .post('/api/planner/meals')
      .set(bearer(me))
      .send({ date: '2026-10-05', slot: 'DINNER', recipeId: pancakes, servings: 2 })
      .expect(201);
    const week = (
      await api()
        .get('/api/planner')
        .query({ from: '2026-10-05', to: '2026-10-11' })
        .set(bearer(me))
        .expect(200)
    ).body;
    expect(week.cost).toEqual({ currency: 'PLN', cents: 340, missing: 0 });
  });

  it('cennik gospodarstwa jest wspólny; obcy go nie widzi', async () => {
    const partner = await t.login('partner');
    await api().post('/api/household').set(bearer(me)).send({ name: 'Dom' }).expect(201);
    const invite = (await api().post('/api/household/invites').set(bearer(me)).send({}).expect(201)).body;
    await api()
      .post('/api/household/join')
      .set(bearer(partner))
      .send({ token: new URL(invite.url).searchParams.get('token') })
      .expect(201);
    const list = await priceList();
    const theirs = (await api().get('/api/prices').set(bearer(partner)).expect(200)).body.lists;
    expect(theirs.map((l: PriceList) => l.id)).toEqual([list.id]);

    const obcy = await t.login('obcy');
    await api().get(`/api/prices/${list.id}/entries`).set(bearer(obcy)).expect(404);
  });
});
