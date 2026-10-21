import { AssistantAi } from '../src/assistant/assistant-ai.js';
import { createTestApp } from './support/app.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const DAY = 24 * 60 * 60 * 1000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Odpowiedzi "modelu" ustawiane w testach - nigdy prawdziwe API */
const tokens = { inputTokens: 10, outputTokens: 5 };

describe('Asystent (e2e)', () => {
  let t: TestApp;
  let ai: AssistantAi;
  let me: string;
  let ids: Record<string, string>;

  beforeAll(async () => {
    t = await createTestApp();
    ai = t.app.get(AssistantAi);
    const byName = async (namePl: string) =>
      (await t.prisma.ingredient.findFirstOrThrow({ where: { namePl, source: 'USDA' } })).id;
    ids = {
      egg: await byName('Jajko'),
      carrot: await byName('Marchew'),
      flour: await byName('Mąka pszenna'),
    };
    ids.milk = (await t.prisma.ingredient.findFirstOrThrow({ where: { namePl: 'Mleko 3,2%' } })).id;
  });

  beforeEach(async () => {
    await t.prisma.recipeIngredient.deleteMany();
    await t.prisma.recipe.deleteMany();
    await t.prisma.user.deleteMany();
    await t.prisma.household.deleteMany();
    me = await t.login('planujaca');
    ai.enabled = true;
  });

  afterAll(async () => {
    await t.app.close();
  });

  const api = () => t.api();
  const ask = (body: object, status = 200) =>
    api().post('/api/assistant/ask').set(bearer(me)).send(body).expect(status);
  const remaining = async () =>
    (await api().get('/api/assistant/status').set(bearer(me)).expect(200)).body.remaining as number;
  const recipe = async (title: string, mealTypes: string[], ingredients: object[]) =>
    (
      await api()
        .post('/api/recipes')
        .set(bearer(me))
        .send({
          title,
          servings: 2,
          visibility: 'PRIVATE',
          canBeIngredient: false,
          mealTypes,
          ingredients,
          steps: [{ text: 'Gotuj.' }],
          photoIds: [],
        })
        .expect(201)
    ).body.id as string;

  it('bez klucza API wyłączony; prośba spoza tematu - odmowa bez zużycia limitu', async () => {
    ai.enabled = false;
    expect((await api().get('/api/assistant/status').set(bearer(me)).expect(200)).body.enabled).toBe(false);
    await ask({ action: 'PLAN' }, 503);
    ai.enabled = true;
    ai.route = async () => ({
      output: { task: 'OFF_TOPIC', slots: [], days: null, wishes: '', budget: null },
      ...tokens,
    });
    expect((await ask({ text: 'Opowiedz mi kawał' })).body).toEqual({ type: 'MESSAGE', code: 'OFF_TOPIC' });
    expect(await remaining()).toBe(5);
  });

  it('plan tygodnia: kandydaci z bazy, sprawdzona odpowiedź, zapis z gotowaniem partiami', async () => {
    const oats = await recipe(
      'Owsianka',
      ['BREAKFAST'],
      [{ ingredientId: ids.milk, amount: 200, unitCode: 'ml' }],
    );
    const soup = await recipe(
      'Zupa marchewkowa',
      ['DINNER'],
      [{ ingredientId: ids.carrot, amount: 400, unitCode: 'g' }],
    );
    await recipe('Naleśniki', ['SUPPER'], [{ ingredientId: ids.flour, amount: 150, unitCode: 'g' }]);
    let context = '';
    ai.route = async () => ({
      output: {
        task: 'PLAN',
        slots: ['BREAKFAST', 'DINNER'],
        days: 2,
        wishes: 'obiady sycące',
        budget: null,
      },
      ...tokens,
    });
    ai.plan = async (c) => {
      context = c;
      const code = (title: string) =>
        c
          .split('\n')
          .find((l) => l.includes(title))!
          .split(' | ')[0];
      return {
        output: {
          summary: 'Dwa dni prostych posiłków.',
          meals: [
            { day: 1, slot: 'BREAKFAST', recipe: code('Owsianka'), leftover: false, alternatives: [] },
            {
              day: 1,
              slot: 'DINNER',
              recipe: code('Zupa'),
              leftover: false,
              alternatives: [code('Owsianka')],
            },
            { day: 2, slot: 'DINNER', recipe: code('Zupa'), leftover: true, alternatives: [] },
            { day: 2, slot: 'DINNER', recipe: code('Owsianka'), leftover: false, alternatives: [] }, // duplikat posiłku
            { day: 9, slot: 'BREAKFAST', recipe: 'r1', leftover: false, alternatives: [] }, // poza planem
            { day: 2, slot: 'BREAKFAST', recipe: 'r99', leftover: false, alternatives: [] }, // nieznany kod
          ],
        },
        ...tokens,
      };
    };
    const res = (await ask({ text: 'Ułóż mi śniadania i obiady na 2 dni, obiady sycące' })).body;
    expect(context).toContain('obiady sycące');
    expect(context).toContain('Owsianka');
    expect(context).not.toContain('Naleśniki'); // kolacji nie planujemy
    expect(res.type).toBe('PLAN');
    expect(res.days).toHaveLength(2);
    expect(
      res.days[0].meals.map((m: { slot: string; recipe: { title: string } }) => [m.slot, m.recipe.title]),
    ).toEqual([
      ['BREAKFAST', 'Owsianka'],
      ['DINNER', 'Zupa marchewkowa'],
    ]);
    expect(res.days[1].meals).toHaveLength(1);
    expect(res.days[0].meals[1].alternatives.map((a: { title: string }) => a.title)).toEqual(['Owsianka']);
    expect(await remaining()).toBe(4);

    const tomorrow = res.days[0].date;
    const next = res.days[1].date;
    await api()
      .post('/api/assistant/plan/apply')
      .set(bearer(me))
      .send({
        meals: [
          { date: tomorrow, slot: 'BREAKFAST', recipeId: oats, leftover: false },
          { date: tomorrow, slot: 'DINNER', recipeId: soup, leftover: false },
          { date: next, slot: 'DINNER', recipeId: soup, leftover: true },
        ],
      })
      .expect(200);
    const cooks = await t.prisma.planCook.findMany({ include: { meals: true }, orderBy: { date: 'asc' } });
    const soupCook = cooks.find((c) => c.recipeId === soup)!;
    expect(cooks).toHaveLength(2);
    expect(soupCook).toMatchObject({ servings: 2 });
    expect(soupCook.meals).toHaveLength(2);
  });

  it('przepisy z lodówki: pusta lodówka bez AI; braki policzone przez serwer', async () => {
    expect((await ask({ action: 'PANTRY' })).body).toEqual({ type: 'MESSAGE', code: 'PANTRY_EMPTY' });
    expect(await remaining()).toBe(5);
    await recipe(
      'Jajecznica',
      ['BREAKFAST'],
      [
        { ingredientId: ids.egg, amount: 3, unitCode: 'PIECE' },
        { ingredientId: ids.milk, amount: 50, unitCode: 'ml' },
      ],
    );
    await api().post('/api/pantry').set(bearer(me)).send({ ingredientId: ids.egg }).expect(201);
    ai.pantry = async (c) => ({
      output: {
        summary: 'Zużyjesz jajka.',
        picks: [
          {
            recipe: c
              .split('\n')
              .find((l) => l.startsWith('r1'))!
              .split(' | ')[0],
            reason: 'Masz jajka.',
          },
          { recipe: 'r42', reason: 'x' },
        ],
      },
      ...tokens,
    });
    const res = (await ask({ action: 'PANTRY' })).body;
    expect(res).toMatchObject({ type: 'PANTRY', summary: 'Zużyjesz jajka.' });
    expect(res.recipes).toEqual([
      expect.objectContaining({
        recipe: expect.objectContaining({ title: 'Jajecznica' }),
        reason: 'Masz jajka.',
        have: ['Jajko'],
        missing: ['Mleko 3,2%'],
      }),
    ]);
  });

  it('uzupełnij zakupy (bez AI): braki na zaplanowane posiłki i to, co kupujesz regularnie', async () => {
    const soup = await recipe('Zupa', ['DINNER'], [{ ingredientId: ids.carrot, amount: 400, unitCode: 'g' }]);
    await api()
      .post('/api/planner/meals')
      .set(bearer(me))
      .send({ date: iso(new Date(Date.now() + DAY)), slot: 'DINNER', recipeId: soup, servings: 2 })
      .expect(201);
    // Mleko z paragonów co 5 dni, ostatnio 6 dni temu
    await api().post('/api/prices').set(bearer(me)).send({ name: 'Biedronka' }).expect(201);
    const list = await t.prisma.priceList.findFirstOrThrow();
    const userId = (await t.prisma.user.findFirstOrThrow({ where: { username: 'planujaca' } })).id;
    for (const ago of [16, 11, 6]) {
      await t.prisma.priceObservation.create({
        data: {
          userId,
          listId: list.id,
          ingredientId: ids.milk,
          source: 'RECEIPT',
          storeName: 'Biedronka',
          purchasedOn: new Date(iso(new Date(Date.now() - ago * DAY))),
          currency: 'PLN',
          packageAmount: 1,
          packageUnitCode: 'l',
          packageGrams: 1030,
          packages: 2,
          priceCents: 329,
        },
      });
    }
    const res = (await ask({ action: 'SHOPPING' })).body;
    expect(res.plan).toEqual([
      expect.objectContaining({
        ingredient: expect.objectContaining({ id: ids.carrot }),
        grams: 400,
        reason: 'PLAN',
      }),
    ]);
    expect(res.regular).toEqual([
      expect.objectContaining({
        ingredient: expect.objectContaining({ id: ids.milk }),
        grams: 2060,
        everyDays: 5,
        lastDaysAgo: 6,
      }),
    ]);
    expect(await remaining()).toBe(5); // bez AI - bez limitu

    await api()
      .post('/api/assistant/shopping/apply')
      .set(bearer(me))
      .send({ items: [{ ingredientId: ids.carrot, grams: 400 }] })
      .expect(200);
    // Już na liście - drugi raz nie podpowiadamy
    expect((await ask({ action: 'SHOPPING' })).body.plan).toEqual([]);
  });

  it('wersja przepisu: szkic z dopasowaniem, zapis jako wariant oryginału', async () => {
    const original = await recipe(
      'Placki',
      ['BREAKFAST'],
      [
        { ingredientId: ids.egg, amount: 2, unitCode: 'PIECE' },
        { ingredientId: ids.flour, amount: 200, unitCode: 'g' },
      ],
    );
    let context = '';
    ai.variant = async (c) => {
      context = c;
      return {
        output: {
          isRecipe: true,
          title: 'Placki bez glutenu',
          description: null,
          servings: 2,
          prepMinutes: 10,
          cookMinutes: 15,
          ingredients: [
            { text: '2 jajka', name: 'jajko', amount: 2, unit: 'PIECE', note: null, uncertain: false },
            {
              text: '200 g mąki ryżowej',
              name: 'mąka ryżowa',
              amount: 200,
              unit: 'g',
              note: null,
              uncertain: false,
            },
          ],
          steps: ['Wymieszaj.', 'Usmaż.'],
          warnings: ['Placki będą bardziej kruche.'],
          changes: [{ change: 'Mąka ryżowa zamiast pszennej', why: 'Bez glutenu, podobna konsystencja.' }],
        },
        ...tokens,
      };
    };
    const res = (
      await api()
        .post('/api/assistant/variant')
        .set(bearer(me))
        .send({ recipeId: original, kind: 'GLUTEN_FREE' })
        .expect(200)
    ).body;
    expect(context).toContain('wersja bez glutenu');
    expect(context).toContain('Mąka pszenna: 200 g');
    expect(res.draft).toMatchObject({
      title: 'Placki bez glutenu',
      warnings: ['Placki będą bardziej kruche.'],
    });
    expect(res.draft.ingredients[0]).toMatchObject({ match: { namePl: 'Jajko' } });
    expect(res.changes).toEqual([
      { change: 'Mąka ryżowa zamiast pszennej', why: 'Bez glutenu, podobna konsystencja.' },
    ]);

    const created = (
      await api()
        .post('/api/recipes')
        .set(bearer(me))
        .send({
          title: 'Placki bez glutenu',
          variantOfId: original,
          servings: 2,
          visibility: 'PRIVATE',
          canBeIngredient: false,
          mealTypes: [],
          ingredients: [{ ingredientId: ids.egg, amount: 2, unitCode: 'PIECE' }],
          steps: [],
          photoIds: [],
        })
        .expect(201)
    ).body;
    expect(created.variantOf).toMatchObject({ id: original });
  });

  it('plan z budżetem: szybka akcja z dopiskiem, koszt porcji w kontekście i w wyniku', async () => {
    const soup = await recipe(
      'Zupa marchewkowa',
      ['DINNER'],
      [{ ingredientId: ids.carrot, amount: 1000, unitCode: 'g' }],
    );
    await api().post('/api/prices').set(bearer(me)).send({ name: 'Dom' }).expect(201);
    const listId = (await api().get('/api/prices').set(bearer(me)).expect(200)).body.lists[0].id;
    await api()
      .put(`/api/prices/${listId}/entries`)
      .set(bearer(me))
      .send({ ingredientId: ids.carrot, packageAmount: 1, packageUnitCode: 'kg', price: 4 })
      .expect(200);
    let routed = '';
    ai.route = async (text) => {
      routed = text;
      // Model rozpoznał np. "zadania" jako coś innego - przy szybkiej akcji i tak planujemy
      return {
        output: { task: 'OFF_TOPIC', slots: ['DINNER'], days: 3, wishes: 'tanio', budget: 50 },
        ...tokens,
      };
    };
    let context = '';
    ai.plan = async (c) => {
      context = c;
      return {
        output: {
          summary: 'Tanio.',
          meals: [{ day: 1, slot: 'DINNER', recipe: 'r1', leftover: false, alternatives: [] }],
        },
        ...tokens,
      };
    };
    const res = (await ask({ action: 'PLAN', text: 'obiady na 3 dni do 50 zł' })).body;
    expect(routed).toBe('obiady na 3 dni do 50 zł');
    expect(context).toContain('Budżet na cały plan: 50 PLN');
    // 1 kg marchwi po 4 zł na 2 porcje = 2 zł za porcję
    expect(context).toContain('Zupa marchewkowa');
    expect(context).toContain('ok. 2.00 PLN/porcja');
    expect(res).toMatchObject({ type: 'PLAN', currency: 'PLN', budgetCents: 5000 });
    expect(res.days).toHaveLength(3);
    expect(res.days[0].meals[0].recipe).toMatchObject({ id: soup, costPerServingCents: 200 });
  });

  it('dyktowanie listy: pozycje z dopasowaniem do bazy, rzeczy niespożywcze bez składnika', async () => {
    let got = '';
    ai.parseList = async (text) => {
      got = text;
      return {
        output: {
          items: [
            { name: 'mleko 3,2%', amount: 2, unit: 'l', note: null, isFood: true },
            { name: 'ziemniak', amount: 2, unit: 'kg', note: null, isFood: true },
            { name: 'papier do pieczenia', amount: null, unit: null, note: null, isFood: false },
          ],
        },
        ...tokens,
      };
    };
    const res = (
      await api()
        .post('/api/assistant/shopping/parse')
        .set(bearer(me))
        .send({ text: 'dwa litry mleka, 2 kilo ziemniaków i papier do pieczenia' })
        .expect(200)
    ).body;
    expect(got).toContain('dwa litry mleka');
    expect(res.items[0]).toMatchObject({
      name: 'mleko 3,2%',
      amount: 2,
      unit: 'l',
      ingredient: { id: ids.milk },
    });
    expect(res.items[1].ingredient).toMatchObject({ namePl: 'Ziemniaki' });
    expect(res.items[2]).toMatchObject({ name: 'papier do pieczenia', ingredient: null });
    // Drobne zadanie - nie zużywa limitu zadań
    expect(await remaining()).toBe(5);
  });

  it('zamiennik w trakcie gotowania: kontekst z przepisem i lodówką, zły wiersz - 400', async () => {
    const pancakes = await recipe(
      'Placki',
      ['BREAKFAST'],
      [
        { ingredientId: ids.egg, amount: 2, unitCode: 'PIECE' },
        { ingredientId: ids.flour, amount: 200, unitCode: 'g' },
      ],
    );
    await api().post('/api/pantry').set(bearer(me)).send({ ingredientId: ids.milk }).expect(201);
    const detail = (await api().get(`/api/recipes/${pancakes}`).set(bearer(me)).expect(200)).body;
    const eggLine = detail.ingredients.find(
      (l: { ingredient: { id: string } | null }) => l.ingredient?.id === ids.egg,
    );
    let context = '';
    ai.substitute = async (c) => {
      context = c;
      return {
        output: {
          options: [
            { name: 'mleko', amount: '3 łyżki', note: 'Placki będą mniej puszyste.', inPantry: true },
          ],
          tip: null,
        },
        ...tokens,
      };
    };
    const res = (
      await api()
        .post('/api/assistant/substitute')
        .set(bearer(me))
        .send({ recipeId: pancakes, lineId: eggLine.id })
        .expect(200)
    ).body;
    expect(context).toContain('Brakuje: Jajko (2 PIECE)');
    expect(context).toContain('W lodówce: Mleko 3,2%');
    expect(res).toEqual({
      options: [{ name: 'mleko', amount: '3 łyżki', note: 'Placki będą mniej puszyste.', inPantry: true }],
      tip: null,
    });
    await api()
      .post('/api/assistant/substitute')
      .set(bearer(me))
      .send({ recipeId: pancakes, lineId: '0190a000-0000-7000-8000-000000000000' })
      .expect(400);
  });

  it('limit dzienny zadań; błąd modelu', async () => {
    ai.pantry = async () => {
      throw new Error('timeout');
    };
    await api().post('/api/pantry').set(bearer(me)).send({ ingredientId: ids.egg }).expect(201);
    await recipe('Jajko na twardo', ['BREAKFAST'], [{ ingredientId: ids.egg, amount: 1, unitCode: 'PIECE' }]);
    expect((await ask({ action: 'PANTRY' }, 502)).body.code).toBe('IMPORT_FAILED');
    for (let i = 0; i < 4; i++) await ask({ action: 'PANTRY' }, 502);
    expect((await ask({ action: 'PANTRY' }, 429)).body.code).toBe('IMPORT_LIMIT');
    // Uzupełnienie zakupów działa bez limitu
    await ask({ action: 'SHOPPING' });
  });
});
