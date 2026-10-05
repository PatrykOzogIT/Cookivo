import { createTestApp } from './support/app.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Zgłoszenia i moderacja (e2e)', () => {
  let t: TestApp;
  let author: string;
  let admin: string;
  let r1: string;
  let r2: string;
  let r3: string;
  let recipeId: string;
  let flour: string;

  beforeAll(async () => {
    t = await createTestApp();
    flour = (
      await t.prisma.ingredient.findFirstOrThrow({ where: { namePl: 'Mąka pszenna', source: 'USDA' } })
    ).id;
  });

  beforeEach(async () => {
    await t.prisma.recipeIngredient.deleteMany();
    await t.prisma.recipe.deleteMany();
    await t.prisma.user.deleteMany();
    t.mails.length = 0;
    author = await t.login('autorka');
    admin = await t.login('szefowa', { role: 'ADMIN' });
    [r1, r2, r3] = [
      await t.login('zglaszajacy1'),
      await t.login('zglaszajacy2'),
      await t.login('zglaszajacy3'),
    ];
    recipeId = (
      await api()
        .post('/api/recipes')
        .set(bearer(author))
        .send({
          title: 'Placki',
          servings: 2,
          visibility: 'PUBLIC',
          canBeIngredient: false,
          mealTypes: [],
          ingredients: [{ ingredientId: flour, amount: 200, unitCode: 'g' }],
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
  const report = (token: string, body: object) => api().post('/api/reports').set(bearer(token)).send(body);
  const userId = async (username: string) =>
    (await t.prisma.user.findUniqueOrThrow({ where: { usernameNormalized: username } })).id;

  it('przepis: 3 zgłoszenia ukrywają go automatycznie; admin przywraca', async () => {
    const recipe = { targetType: 'RECIPE', recipeId, reason: 'SPAM' };
    expect((await report(r1, recipe).expect(201)).body).toEqual({ status: 'OPEN', autoHidden: false });
    const dup = await report(r1, recipe).expect(409);
    expect(dup.body.code).toBe('ALREADY_REPORTED');
    await report(r2, { ...recipe, reason: 'OFFENSIVE', details: 'wulgarny opis' }).expect(201);
    expect((await report(r3, recipe).expect(201)).body.autoHidden).toBe(true);

    // Ukryty dla innych, autor widzi z powodem
    await api().get(`/api/recipes/${recipeId}`).expect(404);
    const own = (await api().get(`/api/recipes/${recipeId}`).set(bearer(author)).expect(200)).body;
    expect(own).toMatchObject({ hidden: true, hiddenReason: 'AUTO_REPORTS' });

    // Kolejka admina: jedna grupa z trzema zgłoszeniami
    const queue = (await api().get('/api/admin/reports').set(bearer(admin)).expect(200)).body.items;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      targetType: 'RECIPE',
      count: 3,
      hidden: true,
      autoHidden: true,
      recipe: { title: 'Placki', author: 'autorka' },
    });

    await api()
      .post('/api/admin/reports/resolve')
      .set(bearer(admin))
      .send({ targetType: 'RECIPE', recipeId, action: 'RESTORE', note: 'W porządku' })
      .expect(200);
    await api().get(`/api/recipes/${recipeId}`).expect(200);
    const mine = (await api().get('/api/reports/mine').set(bearer(r1)).expect(200)).body.items;
    expect(mine[0]).toMatchObject({ targetType: 'RECIPE', status: 'REJECTED', recipe: { title: 'Placki' } });
    expect(t.mails.filter((m) => m.kind === 'contentHidden')).toHaveLength(0);
  });

  it('admin ukrywa przepis z powodem - autor dostaje maila', async () => {
    await report(r1, { targetType: 'RECIPE', recipeId, reason: 'DANGEROUS' }).expect(201);
    await api()
      .post('/api/admin/reports/resolve')
      .set(bearer(admin))
      .send({ targetType: 'RECIPE', recipeId, action: 'HIDE', note: 'Niebezpieczna metoda' })
      .expect(200);
    const own = (await api().get(`/api/recipes/${recipeId}`).set(bearer(author)).expect(200)).body;
    expect(own).toMatchObject({ hidden: true, hiddenReason: 'Niebezpieczna metoda' });
    expect(t.mails.find((m) => m.kind === 'contentHidden')?.to).toBe('autorka@example.com');
    expect((await api().get('/api/reports/mine').set(bearer(r1)).expect(200)).body.items[0].status).toBe(
      'ACCEPTED',
    );
  });

  it('opinia: ukryta po zgłoszeniach znika ze średniej; autor opinii ją widzi', async () => {
    const rater = await t.login('oceniajacy');
    const raterId = await userId('oceniajacy');
    await api()
      .put(`/api/recipes/${recipeId}/rating`)
      .set(bearer(rater))
      .send({ stars: 1, comment: 'beznadzieja' })
      .expect(200);
    await api().put(`/api/recipes/${recipeId}/rating`).set(bearer(r1)).send({ stars: 5 }).expect(200);

    const rating = { targetType: 'RATING', recipeId, userId: raterId, reason: 'OFFENSIVE' };
    for (const token of [r1, r2, r3]) await report(token, rating).expect(201);

    const detail = (await api().get(`/api/recipes/${recipeId}`).expect(200)).body;
    expect(detail).toMatchObject({ ratingAvg: 5, ratingCount: 1 });
    const publicList = (await api().get(`/api/recipes/${recipeId}/ratings`).expect(200)).body;
    expect(publicList.items.map((i: { stars: number }) => i.stars)).toEqual([5]);
    const ownList = (await api().get(`/api/recipes/${recipeId}/ratings`).set(bearer(rater)).expect(200)).body;
    expect(ownList.items.find((i: { isMine: boolean }) => i.isMine)).toMatchObject({ hidden: true });

    // Własnej opinii nie zgłosisz
    const own = await report(rater, { ...rating, reason: 'SPAM' }).expect(403);
    expect(own.body.code).toBe('OWN_CONTENT');
  });

  it('użytkownik: nazwa ukryta po zgłoszeniach; admin zmienia ją na neutralną', async () => {
    const authorId = await userId('autorka');
    for (const token of [r1, r2, r3]) {
      await report(token, { targetType: 'USER', userId: authorId, reason: 'OFFENSIVE' }).expect(201);
    }
    const list = (await api().get('/api/recipes').expect(200)).body.items;
    expect(list[0].author).toBeNull();

    await api()
      .post('/api/admin/reports/resolve')
      .set(bearer(admin))
      .send({ targetType: 'USER', userId: authorId, action: 'HIDE', note: 'Obraźliwa nazwa' })
      .expect(200);
    const renamed = await t.prisma.user.findUniqueOrThrow({ where: { id: authorId } });
    expect(renamed.username).toMatch(/^kucharz_\d{5}$/);
    expect(renamed.nameHiddenAt).toBeNull();
    expect(t.mails.find((m) => m.kind === 'usernameReset')?.to).toBe('autorka@example.com');
    expect((await api().get('/api/recipes').expect(200)).body.items[0].author.username).toBe(
      renamed.username,
    );
  });

  it('zwykły użytkownik nie widzi kolejki; nie zgłosisz własnego przepisu ani siebie', async () => {
    await api().get('/api/admin/reports').set(bearer(r1)).expect(403);
    await report(author, { targetType: 'RECIPE', recipeId, reason: 'SPAM' }).expect(403);
    await report(r1, { targetType: 'USER', userId: await userId('zglaszajacy1'), reason: 'SPAM' }).expect(
      403,
    );
    await report(r1, { targetType: 'RATING', recipeId, reason: 'SPAM' }).expect(400);
    await api().post('/api/reports').send({ targetType: 'RECIPE', recipeId, reason: 'SPAM' }).expect(401);
  });
});
