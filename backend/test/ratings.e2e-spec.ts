import { createTestApp } from './support/app.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const PASSWORD = 'Zielony-Kalafior-Tańczy-42';

describe('Warianty przepisów i oceny (e2e)', () => {
  let t: TestApp;
  let author: string;
  let cook: string;
  let ids: Record<string, string>;
  let pancakes: string;

  beforeAll(async () => {
    t = await createTestApp();
    const byName = async (namePl: string) =>
      (await t.prisma.ingredient.findFirstOrThrow({ where: { namePl, source: 'USDA' } })).id;
    ids = {
      flour: await byName('Mąka pszenna'),
      rye: await byName('Mąka żytnia'),
      egg: await byName('Jajko'),
    };
  });

  beforeEach(async () => {
    await t.prisma.recipeIngredient.deleteMany();
    await t.prisma.recipe.deleteMany();
    await t.prisma.user.deleteMany();
    author = await t.login('autorka');
    cook = await t.login('kucharz');
    pancakes = (
      await api()
        .post('/api/recipes')
        .set(bearer(author))
        .send(recipe('Naleśniki', 'PUBLIC', ids.flour))
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await t.app.close();
  });

  const api = () => t.api();
  function recipe(title: string, visibility: string, flour: string, extra: object = {}) {
    return {
      title,
      servings: 4,
      visibility,
      canBeIngredient: false,
      mealTypes: ['BREAKFAST'],
      ingredients: [
        { ingredientId: flour, amount: 250, unitCode: 'g' },
        { ingredientId: ids.egg, amount: 2, unitCode: 'PIECE' },
      ],
      steps: [{ text: 'Wymieszaj i usmaż.' }],
      photoIds: [],
      ...extra,
    };
  }

  describe('warianty', () => {
    it('własna wersja: prywatna kopia wskazująca na oryginał, publiczna jako alternatywa', async () => {
      const variant = (await api().post(`/api/recipes/${pancakes}/variant`).set(bearer(cook)).expect(201))
        .body;
      expect(variant).toMatchObject({
        title: 'Naleśniki',
        visibility: 'PRIVATE',
        isOwn: true,
        isVariant: true,
        variantOf: { id: pancakes, author: 'autorka', viewable: true },
      });
      expect(variant.ingredients).toHaveLength(2);
      expect(variant.steps).toHaveLength(1);

      // Prywatny wariant nie jest widoczny pod oryginałem
      let alternatives = (await api().get(`/api/recipes/${pancakes}/variants`).expect(200)).body;
      expect(alternatives.items).toEqual([]);

      // Kucharz zmienia mąkę, opisuje zmianę i publikuje
      await api()
        .patch(`/api/recipes/${variant.id}`)
        .set(bearer(cook))
        .send(recipe('Naleśniki żytnie', 'PUBLIC', ids.rye, { variantNote: 'mąka żytnia zamiast pszennej' }))
        .expect(200);
      alternatives = (await api().get(`/api/recipes/${pancakes}/variants`).expect(200)).body;
      expect(alternatives.originalId).toBe(pancakes);
      expect(alternatives.items).toMatchObject([
        { title: 'Naleśniki żytnie', variantNote: 'mąka żytnia zamiast pszennej', isOriginal: false },
      ]);
      expect((await api().get(`/api/recipes/${pancakes}`).expect(200)).body.variantsCount).toBe(1);

      // Z wariantu widać oryginał; wariant wariantu wskazuje na pierwotny oryginał
      const fromVariant = (await api().get(`/api/recipes/${variant.id}/variants`).expect(200)).body;
      expect(fromVariant.items).toMatchObject([{ id: pancakes, isOriginal: true }]);
      const second = (await api().post(`/api/recipes/${variant.id}/variant`).set(bearer(author)).expect(201))
        .body;
      expect(second.variantOf.id).toBe(pancakes);
    });

    it('nie zrobisz wariantu przepisu, którego nie widzisz', async () => {
      const secret = (
        await api()
          .post('/api/recipes')
          .set(bearer(author))
          .send(recipe('Sekret', 'PRIVATE', ids.flour))
          .expect(201)
      ).body.id;
      await api().post(`/api/recipes/${secret}/variant`).set(bearer(cook)).expect(404);
    });
  });

  describe('oceny', () => {
    it('gwiazdki i komentarz, średnia, zmiana i usunięcie oceny', async () => {
      const first = (
        await api()
          .put(`/api/recipes/${pancakes}/rating`)
          .set(bearer(cook))
          .send({ stars: 5, comment: 'Wyszły idealne!' })
          .expect(200)
      ).body;
      expect(first).toEqual({
        ratingAvg: 5,
        ratingCount: 1,
        myRating: { stars: 5, comment: 'Wyszły idealne!' },
      });

      const third = await t.login('trzeci');
      await api().put(`/api/recipes/${pancakes}/rating`).set(bearer(third)).send({ stars: 2 }).expect(200);
      const detail = (await api().get(`/api/recipes/${pancakes}`).set(bearer(cook)).expect(200)).body;
      expect(detail).toMatchObject({ ratingAvg: 3.5, ratingCount: 2, myRating: { stars: 5 } });

      // Opinie widzi też gość
      const list = (await api().get(`/api/recipes/${pancakes}/ratings`).expect(200)).body;
      expect(list.total).toBe(2);
      expect(list.items.map((i: { username: string }) => i.username).sort()).toEqual(['kucharz', 'trzeci']);

      // Zmiana i usunięcie
      await api().put(`/api/recipes/${pancakes}/rating`).set(bearer(cook)).send({ stars: 4 }).expect(200);
      const after = (await api().delete(`/api/recipes/${pancakes}/rating`).set(bearer(third)).expect(200))
        .body;
      expect(after).toMatchObject({ ratingAvg: 4, ratingCount: 1, myRating: null });
    });

    it('autor nie ocenia własnego przepisu; zła liczba gwiazdek; wulgaryzmy', async () => {
      const own = await api()
        .put(`/api/recipes/${pancakes}/rating`)
        .set(bearer(author))
        .send({ stars: 5 })
        .expect(403);
      expect(own.body.code).toBe('OWN_RECIPE');
      await api().put(`/api/recipes/${pancakes}/rating`).set(bearer(cook)).send({ stars: 6 }).expect(400);
      const bad = await api()
        .put(`/api/recipes/${pancakes}/rating`)
        .set(bearer(cook))
        .send({ stars: 1, comment: 'kurwa, nie wyszło' })
        .expect(400);
      expect(bad.body.code).toBe('CONTENT_OFFENSIVE');
      await api().put(`/api/recipes/${pancakes}/rating`).expect(401);
    });

    it('sortowanie "najlepiej oceniane" i przeliczenie po usunięciu konta', async () => {
      const other = (
        await api()
          .post('/api/recipes')
          .set(bearer(author))
          .send(recipe('Placki', 'PUBLIC', ids.flour))
          .expect(201)
      ).body.id;
      await api().put(`/api/recipes/${other}/rating`).set(bearer(cook)).send({ stars: 5 }).expect(200);
      await api().put(`/api/recipes/${pancakes}/rating`).set(bearer(cook)).send({ stars: 3 }).expect(200);

      const sorted = (await api().get('/api/recipes?sort=rating').expect(200)).body.items;
      expect(sorted.map((r: { title: string }) => r.title)).toEqual(['Placki', 'Naleśniki']);

      const exported = (await api().get('/api/me/export').set(bearer(cook)).expect(200)).body;
      expect(exported.ratings).toHaveLength(2);

      await api().post('/api/me/delete').set(bearer(cook)).send({ password: PASSWORD }).expect(204);
      const detail = (await api().get(`/api/recipes/${other}`).expect(200)).body;
      expect(detail).toMatchObject({ ratingAvg: null, ratingCount: 0 });
    });
  });
});
