import { createTestApp } from './support/app.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const PASSWORD = 'Zielony-Kalafior-Tańczy-42';

describe('Gospodarstwa domowe (e2e)', () => {
  let t: TestApp;
  let ids: Record<string, string>;
  let anna: string;
  let bartek: string;

  beforeAll(async () => {
    t = await createTestApp();
    const byName = async (namePl: string) =>
      (await t.prisma.ingredient.findFirstOrThrow({ where: { namePl, source: 'USDA' } })).id;
    ids = { egg: await byName('Jajko'), carrot: await byName('Marchew'), cod: await byName('Dorsz') };
  });

  beforeEach(async () => {
    await t.prisma.recipeIngredient.deleteMany();
    await t.prisma.recipe.deleteMany();
    await t.prisma.ingredient.deleteMany({ where: { source: 'USER' } });
    await t.prisma.user.deleteMany();
    await t.prisma.household.deleteMany();
    t.mails.length = 0;
    anna = await t.login('anna');
    bartek = await t.login('bartek');
  });

  afterAll(async () => {
    await t.app.close();
  });

  const api = () => t.api();
  const tokenFrom = (url: string) => new URL(url).searchParams.get('token')!;

  /** Anna zakłada gospodarstwo i zaprasza Bartka linkiem */
  async function coupleHousehold() {
    await api().post('/api/household').set(bearer(anna)).send({ name: 'Dom' }).expect(201);
    const invite = (await api().post('/api/household/invites').set(bearer(anna)).send({}).expect(201)).body;
    await api()
      .post('/api/household/join')
      .set(bearer(bartek))
      .send({ token: tokenFrom(invite.url) })
      .expect(201);
  }

  const recipe = (title: string, visibility: string, lines: { ingredientId: string; amount: number }[]) => ({
    title,
    servings: 2,
    visibility,
    canBeIngredient: true,
    mealTypes: [],
    ingredients: lines.map((l) => ({ ...l, unitCode: l.ingredientId === ids.egg ? 'PIECE' : 'g' })),
    steps: [],
    photoIds: [],
  });

  describe('zakładanie i zaproszenia', () => {
    it('bez gospodarstwa GET zwraca null; założyciel jest właścicielem', async () => {
      expect((await api().get('/api/household').set(bearer(anna)).expect(200)).body).toEqual({
        household: null,
      });
      const res = await api().post('/api/household').set(bearer(anna)).send({ name: '  Dom  ' }).expect(201);
      expect(res.body).toMatchObject({
        name: 'Dom',
        role: 'OWNER',
        members: [{ username: 'anna', isMe: true }],
      });
      await api().post('/api/household').set(bearer(anna)).send({ name: 'Drugi' }).expect(409);
    });

    it('zaproszenie mailem: podgląd dla gościa, dołączenie, link jednorazowy', async () => {
      await api().post('/api/household').set(bearer(anna)).send({ name: 'Dom' }).expect(201);
      const invite = (
        await api()
          .post('/api/household/invites')
          .set(bearer(anna))
          .send({ email: 'Bartek@Example.com' })
          .expect(201)
      ).body;
      expect(invite.email).toBe('bartek@example.com');
      const mail = t.mails.find((m) => m.kind === 'householdInvite');
      expect(mail?.to).toBe('bartek@example.com');
      const token = tokenFrom(mail!.url!);

      const preview = await api().get('/api/household/invites/preview').query({ token }).expect(200);
      expect(preview.body).toMatchObject({ household: 'Dom', invitedBy: 'anna', members: 1 });

      const joined = await api().post('/api/household/join').set(bearer(bartek)).send({ token }).expect(201);
      expect(joined.body).toMatchObject({ role: 'MEMBER', invites: [] });
      expect(joined.body.members.map((m: { username: string }) => m.username)).toEqual(['anna', 'bartek']);

      const cela = await t.login('cela');
      const again = await api().post('/api/household/join').set(bearer(cela)).send({ token }).expect(400);
      expect(again.body.code).toBe('INVITE_INVALID');
    });

    it('tylko właściciel zaprasza; odwołane zaproszenie nie działa', async () => {
      await coupleHousehold();
      await api().post('/api/household/invites').set(bearer(bartek)).send({}).expect(403);
      const invite = (await api().post('/api/household/invites').set(bearer(anna)).send({}).expect(201)).body;
      await api().delete(`/api/household/invites/${invite.id}`).set(bearer(anna)).expect(204);
      const cela = await t.login('cela');
      await api()
        .post('/api/household/join')
        .set(bearer(cela))
        .send({ token: tokenFrom(invite.url) })
        .expect(400);
    });

    it('członek innego gospodarstwa nie dołączy bez opuszczenia swojego', async () => {
      await api().post('/api/household').set(bearer(anna)).send({ name: 'Dom' }).expect(201);
      await api().post('/api/household').set(bearer(bartek)).send({ name: 'Mieszkanie' }).expect(201);
      const invite = (await api().post('/api/household/invites').set(bearer(anna)).send({}).expect(201)).body;
      const res = await api()
        .post('/api/household/join')
        .set(bearer(bartek))
        .send({ token: tokenFrom(invite.url) })
        .expect(409);
      expect(res.body.code).toBe('ALREADY_IN_HOUSEHOLD');
    });
  });

  describe('członkowie', () => {
    it('odejście właściciela przekazuje rolę; ostatnia osoba zamyka gospodarstwo', async () => {
      await coupleHousehold();
      await api().post('/api/household/leave').set(bearer(anna)).expect(204);
      const b = (await api().get('/api/household').set(bearer(bartek)).expect(200)).body.household;
      expect(b).toMatchObject({ role: 'OWNER', members: [{ username: 'bartek' }] });
      await api().post('/api/household/leave').set(bearer(bartek)).expect(204);
      expect(await t.prisma.household.count()).toBe(0);
    });

    it('przekazanie roli i usunięcie członka', async () => {
      await coupleHousehold();
      const bId = (await t.prisma.user.findUniqueOrThrow({ where: { email: 'bartek@example.com' } })).id;
      const aId = (await t.prisma.user.findUniqueOrThrow({ where: { email: 'anna@example.com' } })).id;
      await api().post(`/api/household/members/${bId}/owner`).set(bearer(anna)).expect(201);
      await api().delete(`/api/household/members/${bId}`).set(bearer(anna)).expect(403);
      const res = await api().delete(`/api/household/members/${aId}`).set(bearer(bartek)).expect(200);
      expect(res.body.members).toHaveLength(1);
      expect((await api().get('/api/household').set(bearer(anna)).expect(200)).body.household).toBeNull();
    });
  });

  describe('alergie i przepisy', () => {
    it('alergie domownika widać i uwzględniamy tylko za jego zgodą', async () => {
      await coupleHousehold();
      const author = await t.login('autor');
      const post = (body: object) => api().post('/api/recipes').set(bearer(author)).send(body).expect(201);
      await post(recipe('Omlet', 'PUBLIC', [{ ingredientId: ids.egg, amount: 2 }]));
      await post(recipe('Marchewka', 'PUBLIC', [{ ingredientId: ids.carrot, amount: 200 }]));

      await api()
        .post('/api/me/consents/health-data')
        .set(bearer(bartek))
        .send({ granted: true })
        .expect(200);
      await api()
        .put('/api/me/allergens')
        .set(bearer(bartek))
        .send({ allergens: [{ code: 'EGGS', severity: 'ALLERGY' }] })
        .expect(200);

      const titles = async (token: string, qs: string) =>
        (await api().get(`/api/recipes?${qs}`).set(bearer(token)).expect(200)).body.items
          .map((r: { title: string }) => r.title)
          .sort();

      // Bez zgody: Anna nie widzi alergii Bartka, "Dla nas" ich nie uwzględnia
      let view = (await api().get('/api/household').set(bearer(anna)).expect(200)).body.household;
      expect(view.members.find((m: { username: string }) => m.username === 'bartek').allergens).toBeNull();
      expect(await titles(anna, 'forUs=true')).toEqual(['Marchewka', 'Omlet']);

      await api().put('/api/household/share-allergies').set(bearer(bartek)).send({ share: true }).expect(200);
      view = (await api().get('/api/household').set(bearer(anna)).expect(200)).body.household;
      expect(view.members.find((m: { username: string }) => m.username === 'bartek').allergens).toMatchObject(
        [{ code: 'EGGS', severity: 'ALLERGY' }],
      );
      expect(await titles(anna, 'forUs=true')).toEqual(['Marchewka']);
      expect(await titles(anna, 'forMe=true')).toEqual(['Marchewka', 'Omlet']);

      // Wycofanie zgody na dane o zdrowiu wyłącza też udostępnianie
      await api()
        .post('/api/me/consents/health-data')
        .set(bearer(bartek))
        .send({ granted: false })
        .expect(200);
      view = (await api().get('/api/household').set(bearer(anna)).expect(200)).body.household;
      expect(view.members.find((m: { username: string }) => m.username === 'bartek').shareAllergies).toBe(
        false,
      );
    });

    it('udostępnienie alergii wymaga zgody na dane o zdrowiu', async () => {
      await coupleHousehold();
      const res = await api().put('/api/household/share-allergies').set(bearer(bartek)).send({ share: true });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('HEALTH_CONSENT_REQUIRED');
    });

    it('przepis "dla gospodarstwa" widzą tylko domownicy', async () => {
      await coupleHousehold();
      const created = (
        await api()
          .post('/api/recipes')
          .set(bearer(anna))
          .send(recipe('Rodzinna zupa', 'HOUSEHOLD', [{ ingredientId: ids.carrot, amount: 300 }]))
          .expect(201)
      ).body;
      const obcy = await t.login('obcy');

      await api().get(`/api/recipes/${created.id}`).set(bearer(bartek)).expect(200);
      await api().get(`/api/recipes/${created.id}`).set(bearer(obcy)).expect(404);
      await api().get(`/api/recipes/${created.id}`).expect(404);

      const list = async (token: string, qs = '') =>
        (await api().get(`/api/recipes?${qs}`).set(bearer(token)).expect(200)).body.items.map(
          (r: { title: string }) => r.title,
        );
      expect(await list(bartek, 'household=true')).toEqual(['Rodzinna zupa']);
      expect(await list(obcy)).toEqual([]);

      // Domownik nie edytuje cudzego przepisu
      await api()
        .patch(`/api/recipes/${created.id}`)
        .set(bearer(bartek))
        .send(recipe('Zmieniona', 'HOUSEHOLD', [{ ingredientId: ids.carrot, amount: 300 }]))
        .expect(403);

      // Po odejściu z gospodarstwa przepis znika z widoku
      await api().post('/api/household/leave').set(bearer(bartek)).expect(204);
      await api().get(`/api/recipes/${created.id}`).set(bearer(bartek)).expect(404);
    });

    it('podprzepis: publiczny nie użyje przepisu grupy; grupowy nie użyje prywatnego', async () => {
      await coupleHousehold();
      const create = async (token: string, body: object, status = 201) =>
        (await api().post('/api/recipes').set(bearer(token)).send(body).expect(status)).body;
      const broth = await create(
        anna,
        recipe('Wywar', 'HOUSEHOLD', [{ ingredientId: ids.carrot, amount: 500 }]),
      );
      const secret = await create(
        anna,
        recipe('Sekret', 'PRIVATE', [{ ingredientId: ids.cod, amount: 100 }]),
      );
      const useSub = (title: string, visibility: string, subRecipeId: string) => ({
        ...recipe(title, visibility, []),
        ingredients: [{ subRecipeId, amount: 200, unitCode: 'g' }],
      });

      // Bartek (domownik) może użyć wywaru w swoim przepisie dla gospodarstwa
      await create(bartek, useSub('Zupa Bartka', 'HOUSEHOLD', broth.id));
      const pub = await create(bartek, useSub('Zupa publiczna', 'PUBLIC', broth.id), 400);
      expect(pub.code).toBe('SUBRECIPE_PRIVATE');
      const priv = await create(anna, useSub('Zupa z sekretem', 'HOUSEHOLD', secret.id), 400);
      expect(priv.code).toBe('SUBRECIPE_PRIVATE');

      // Anna nie może ukryć wywaru, którego używa Bartek
      const hide = await api()
        .patch(`/api/recipes/${broth.id}`)
        .set(bearer(anna))
        .send(recipe('Wywar', 'PRIVATE', [{ ingredientId: ids.carrot, amount: 500 }]))
        .expect(409);
      expect(hide.body.code).toBe('RECIPE_IN_USE');
    });
  });

  describe('RODO', () => {
    it('usunięcie konta właściciela przekazuje gospodarstwo; eksport zawiera członkostwo', async () => {
      await coupleHousehold();
      const exported = (await api().get('/api/me/export').set(bearer(bartek)).expect(200)).body;
      expect(exported.household).toMatchObject({ name: 'Dom', role: 'MEMBER' });

      await api().post('/api/me/delete').set(bearer(anna)).send({ password: PASSWORD }).expect(204);
      const b = (await api().get('/api/household').set(bearer(bartek)).expect(200)).body.household;
      expect(b).toMatchObject({ role: 'OWNER', members: [{ username: 'bartek' }] });
    });
  });
});
