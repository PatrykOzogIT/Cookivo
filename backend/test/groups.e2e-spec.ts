import { MAX_OWNED_GROUPS } from '../src/groups/groups.service.js';
import { createTestApp } from './support/app.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Grupy znajomych (e2e)', () => {
  let t: TestApp;
  let egg: string;
  let anna: string;
  let bartek: string;
  let cela: string;
  let obcy: string;

  beforeAll(async () => {
    t = await createTestApp();
    egg = (await t.prisma.ingredient.findFirstOrThrow({ where: { namePl: 'Jajko', source: 'USDA' } })).id;
  });

  beforeEach(async () => {
    await t.prisma.recipeIngredient.deleteMany();
    await t.prisma.recipe.deleteMany();
    await t.prisma.user.deleteMany();
    await t.prisma.friendGroup.deleteMany();
    await t.prisma.household.deleteMany();
    t.mails.length = 0;
    anna = await t.login('anna');
    bartek = await t.login('bartek');
    cela = await t.login('cela');
    obcy = await t.login('obcy');
  });

  afterAll(async () => {
    await t.app.close();
  });

  const api = () => t.api();
  const tokenFrom = (url: string) => new URL(url).searchParams.get('token')!;
  const userId = async (username: string) =>
    (await t.prisma.user.findFirstOrThrow({ where: { username } })).id;

  async function createGroup(token: string, name = 'Kuchnia'): Promise<string> {
    return (await api().post('/api/groups').set(bearer(token)).send({ name }).expect(201)).body.id;
  }

  async function inviteAndJoin(groupId: string, inviter: string, joiner: string) {
    const invite = (
      await api().post(`/api/groups/${groupId}/invites`).set(bearer(inviter)).send({}).expect(201)
    ).body;
    return (
      await api()
        .post('/api/groups/join')
        .set(bearer(joiner))
        .send({ token: tokenFrom(invite.url) })
        .expect(201)
    ).body;
  }

  const recipe = (title: string, visibility: string, groupIds: string[] = [], extra: object = {}) => ({
    title,
    servings: 2,
    visibility,
    groupIds,
    canBeIngredient: true,
    mealTypes: [],
    ingredients: [{ ingredientId: egg, amount: 2, unitCode: 'PIECE' }],
    steps: [],
    photoIds: [],
    ...extra,
  });

  describe('członkostwo', () => {
    it('zaproszenie od właściciela = od razu członek; od członka = czeka na akceptację', async () => {
      const g = await createGroup(anna);
      expect((await inviteAndJoin(g, anna, bartek)).status).toBe('ACTIVE');

      // Bartek (członek) zaprasza Celę - podgląd mówi, że trzeba akceptacji
      const invite = (await api().post(`/api/groups/${g}/invites`).set(bearer(bartek)).send({}).expect(201))
        .body;
      const preview = await api()
        .get('/api/groups/invites/preview')
        .query({ token: tokenFrom(invite.url) })
        .expect(200);
      expect(preview.body).toMatchObject({ group: 'Kuchnia', invitedBy: 'bartek', needsApproval: true });

      const joined = await api()
        .post('/api/groups/join')
        .set(bearer(cela))
        .send({ token: tokenFrom(invite.url) })
        .expect(201);
      expect(joined.body).toMatchObject({ status: 'PENDING', members: [] });
      // Właściciel dostał mail i widzi osobę do akceptacji; zwykły członek - nie
      expect(t.mails.some((m) => m.kind === 'groupJoinRequest')).toBe(true);
      const owner = await api().get(`/api/groups/${g}`).set(bearer(anna)).expect(200);
      expect(owner.body.pending).toEqual([
        expect.objectContaining({ username: 'cela', invitedBy: 'bartek' }),
      ]);
      expect((await api().get(`/api/groups/${g}`).set(bearer(bartek)).expect(200)).body.pending).toEqual([]);

      // Oczekująca nie może zapraszać
      await api().post(`/api/groups/${g}/invites`).set(bearer(cela)).send({}).expect(403);

      const celaId = await userId('cela');
      await api().post(`/api/groups/${g}/members/${celaId}/approve`).set(bearer(bartek)).expect(403);
      await api().post(`/api/groups/${g}/members/${celaId}/approve`).set(bearer(anna)).expect(201);
      expect(t.mails.some((m) => m.kind === 'groupApproved')).toBe(true);
      const after = await api().get(`/api/groups/${g}`).set(bearer(cela)).expect(200);
      expect(after.body.status).toBe('ACTIVE');
      expect(after.body.members).toHaveLength(3);
    });

    it('obcy nie widzi grupy, link jest jednorazowy, nie można dołączyć drugi raz', async () => {
      const g = await createGroup(anna);
      await api().get(`/api/groups/${g}`).set(bearer(obcy)).expect(404);
      const invite = (await api().post(`/api/groups/${g}/invites`).set(bearer(anna)).send({}).expect(201))
        .body;
      await api()
        .post('/api/groups/join')
        .set(bearer(bartek))
        .send({ token: tokenFrom(invite.url) })
        .expect(201);
      await api()
        .post('/api/groups/join')
        .set(bearer(cela))
        .send({ token: tokenFrom(invite.url) })
        .expect(400);
      const again = await api().post(`/api/groups/${g}/invites`).set(bearer(anna)).send({}).expect(201);
      await api()
        .post('/api/groups/join')
        .set(bearer(bartek))
        .send({ token: tokenFrom(again.body.url) })
        .expect(409);
    });

    it(`limit założonych grup: ${MAX_OWNED_GROUPS}`, async () => {
      for (let i = 0; i < MAX_OWNED_GROUPS; i++) await createGroup(anna, `Grupa ${i}`);
      const res = await api().post('/api/groups').set(bearer(anna)).send({ name: 'Za dużo' }).expect(409);
      expect(res.body.code).toBe('GROUP_OWNED_LIMIT');
      expect((await api().get('/api/groups').set(bearer(anna)).expect(200)).body.items).toHaveLength(
        MAX_OWNED_GROUPS,
      );
    });

    it('odejście właściciela przekazuje grupę, ostatnia osoba ją zamyka', async () => {
      const g = await createGroup(anna);
      await inviteAndJoin(g, anna, bartek);
      await api().post(`/api/groups/${g}/leave`).set(bearer(anna)).expect(204);
      const res = await api().get(`/api/groups/${g}`).set(bearer(bartek)).expect(200);
      expect(res.body.role).toBe('OWNER');
      await api().post(`/api/groups/${g}/leave`).set(bearer(bartek)).expect(204);
      expect(await t.prisma.friendGroup.count()).toBe(0);
    });
  });

  describe('przepisy dla grup', () => {
    it('widzą członkowie grupy i domownicy autora; obcy i oczekujący - nie', async () => {
      const g = await createGroup(anna);
      await inviteAndJoin(g, anna, bartek);
      // Cela czeka na akceptację (zaprosił ją Bartek)
      await inviteAndJoin(g, bartek, cela);
      // Domownik Anny spoza grupy
      await api().post('/api/household').set(bearer(anna)).send({ name: 'Dom' }).expect(201);
      const hInvite = (await api().post('/api/household/invites').set(bearer(anna)).send({}).expect(201))
        .body;
      await api()
        .post('/api/household/join')
        .set(bearer(obcy))
        .send({ token: tokenFrom(hInvite.url) })
        .expect(201);
      const stranger = await t.login('zosia');

      const created = await api()
        .post('/api/recipes')
        .set(bearer(anna))
        .send(recipe('Omlet grupowy', 'GROUPS', [g]))
        .expect(201);
      expect(created.body.groups).toEqual([{ id: g, name: 'Kuchnia' }]);
      const id = created.body.id;

      await api().get(`/api/recipes/${id}`).set(bearer(bartek)).expect(200);
      await api().get(`/api/recipes/${id}`).set(bearer(obcy)).expect(200); // domownik
      await api().get(`/api/recipes/${id}`).set(bearer(cela)).expect(404); // oczekująca
      await api().get(`/api/recipes/${id}`).set(bearer(stranger)).expect(404);
      await api().get(`/api/recipes/${id}`).expect(404);

      const list = await api().get('/api/recipes').query({ groups: 1 }).set(bearer(bartek)).expect(200);
      expect(list.body.items.map((r: { title: string }) => r.title)).toEqual(['Omlet grupowy']);
      const one = await api().get('/api/recipes').query({ groupId: g }).set(bearer(bartek)).expect(200);
      expect(one.body.total).toBe(1);
      expect(
        (await api().get('/api/recipes').query({ groupId: g }).set(bearer(stranger)).expect(200)).body.total,
      ).toBe(0);

      // Członek może ocenić przepis grupy
      await api().put(`/api/recipes/${id}/rating`).set(bearer(bartek)).send({ stars: 5 }).expect(200);
    });

    it('grupy są wymagane i tylko te, w których autor jest aktywnym członkiem', async () => {
      const g = await createGroup(anna);
      const other = await createGroup(obcy, 'Cudza');
      const none = await api()
        .post('/api/recipes')
        .set(bearer(anna))
        .send(recipe('Bez grup', 'GROUPS', []))
        .expect(400);
      expect(none.body.code).toBe('GROUPS_REQUIRED');
      const foreign = await api()
        .post('/api/recipes')
        .set(bearer(anna))
        .send(recipe('Cudza grupa', 'GROUPS', [g, other]))
        .expect(400);
      expect(foreign.body.code).toBe('GROUP_UNKNOWN');
    });

    it('wyjście z grupy cofa udostępnienie przepisów tej osoby w grupie', async () => {
      const g = await createGroup(anna);
      await inviteAndJoin(g, anna, bartek);
      const id = (
        await api()
          .post('/api/recipes')
          .set(bearer(bartek))
          .send(recipe('Bartka', 'GROUPS', [g]))
          .expect(201)
      ).body.id;
      await api().get(`/api/recipes/${id}`).set(bearer(anna)).expect(200);
      await api().post(`/api/groups/${g}/leave`).set(bearer(bartek)).expect(204);
      await api().get(`/api/recipes/${id}`).set(bearer(anna)).expect(404);
    });

    it('podprzepis musi być widoczny dla tych samych grup', async () => {
      const g = await createGroup(anna);
      const priv = (
        await api().post('/api/recipes').set(bearer(anna)).send(recipe('Sos prywatny', 'PRIVATE')).expect(201)
      ).body.id;
      const shared = (
        await api()
          .post('/api/recipes')
          .set(bearer(anna))
          .send(recipe('Sos grupowy', 'GROUPS', [g]))
          .expect(201)
      ).body.id;
      const withSub = (subId: string) =>
        recipe('Danie', 'GROUPS', [g], {
          ingredients: [{ subRecipeId: subId, amount: 200, unitCode: 'g' }],
        });
      const bad = await api().post('/api/recipes').set(bearer(anna)).send(withSub(priv)).expect(400);
      expect(bad.body.code).toBe('SUBRECIPE_PRIVATE');
      await api().post('/api/recipes').set(bearer(anna)).send(withSub(shared)).expect(201);
      // Publiczny przepis nie może użyć podprzepisu "dla grup"
      const pub = await api()
        .post('/api/recipes')
        .set(bearer(anna))
        .send({ ...withSub(shared), visibility: 'PUBLIC', groupIds: [] })
        .expect(400);
      expect(pub.body.code).toBe('SUBRECIPE_PRIVATE');
    });
  });

  it('usunięcie konta właściciela przekazuje grupę dalej', async () => {
    const g = await createGroup(anna);
    await inviteAndJoin(g, anna, bartek);
    await api()
      .post('/api/me/delete')
      .set(bearer(anna))
      .send({ password: 'Zielony-Kalafior-Tańczy-42' })
      .expect(204);
    const res = await api().get(`/api/groups/${g}`).set(bearer(bartek)).expect(200);
    expect(res.body).toMatchObject({ role: 'OWNER', memberCount: 1 });
  });
});
