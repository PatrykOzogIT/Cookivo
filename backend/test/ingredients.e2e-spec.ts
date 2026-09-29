import { createTestApp } from './support/app.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const NEW_INGREDIENT = {
  namePl: 'Twaróg półtłusty',
  nameEn: 'Semi-skimmed quark',
  categoryCode: 'DAIRY',
  kcal: 133,
  protein: 18.7,
  fat: 4.7,
  saturatedFat: 2.9,
  carbs: 3.7,
  sugars: 3.7,
  fiber: 0,
  salt: 0.1,
  allergens: ['MILK'],
  units: [
    { code: 'TABLESPOON', grams: 25 },
    { code: 'PACKAGE', grams: 250 },
  ],
};

describe('Składniki (e2e)', () => {
  let t: TestApp;
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    // Czyścimy tylko dane użytkowników - składniki z seeda zostają
    // Przepisy z innych testów mogą trzymać składniki użytkowników
    await t.prisma.recipeIngredient.deleteMany();
    await t.prisma.recipe.deleteMany();
    await t.prisma.ingredient.deleteMany({ where: { source: 'USER' } });
    await t.prisma.user.deleteMany();
  });

  afterAll(async () => {
    await t.app.close();
  });

  describe('przeglądanie (także dla gości)', () => {
    it('zwraca słowniki: 14 alergenów UE, kategorie i jednostki', async () => {
      const res = await t.api().get('/api/dictionaries').expect(200);
      expect(res.body.allergens).toHaveLength(14);
      expect(res.body.allergens[0]).toEqual({
        code: 'GLUTEN',
        namePl: 'Gluten',
        nameEn: 'Gluten',
        icon: 'grain',
      });
      expect(res.body.categories.map((c: { code: string }) => c.code)).toContain('DAIRY');
      expect(res.body.units.find((u: { code: string }) => u.code === 'TABLESPOON').ml).toBe(15);
    });

    it('wyszukuje bez polskich znaków i z literówkami, najlepsze dopasowanie pierwsze', async () => {
      const zolty = await t.api().get('/api/ingredients?q=zoltko').expect(200);
      expect(zolty.body.items[0].namePl).toBe('Żółtko jaja');

      const typo = await t.api().get('/api/ingredients?q=pomidr').expect(200);
      expect(typo.body.items[0].namePl).toBe('Pomidor');

      const english = await t.api().get('/api/ingredients?q=chicken breast').expect(200);
      expect(english.body.items[0].namePl).toBe('Pierś z kurczaka');
    });

    it('zwraca wartości odżywcze na 100 g w standardzie UE, alergeny i jednostki', async () => {
      const res = await t.api().get('/api/ingredients?q=jajko').expect(200);
      const egg = res.body.items.find((i: { namePl: string }) => i.namePl === 'Jajko');
      expect(egg.nutrition).toMatchObject({ kcal: 143, protein: 12.6, fat: 9.5 });
      expect(egg.allergens.map((a: { code: string }) => a.code)).toEqual(['EGGS']);
      expect(egg.units).toEqual([{ code: 'PIECE', namePl: 'sztuka', nameEn: 'piece', grams: 50 }]);
      expect(egg.source).toBe('USDA');
      expect(egg.canEdit).toBe(false);
    });

    it('filtruje po kategorii i wyklucza alergeny', async () => {
      const res = await t
        .api()
        .get('/api/ingredients?category=BAKERY&excludeAllergens=GLUTEN&pageSize=50')
        .expect(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      for (const item of res.body.items) {
        expect(item.category.code).toBe('BAKERY');
        expect(item.allergens.map((a: { code: string }) => a.code)).not.toContain('GLUTEN');
      }
    });

    it('stronicuje wyniki', async () => {
      const p1 = await t.api().get('/api/ingredients?pageSize=10&page=1').expect(200);
      const p2 = await t.api().get('/api/ingredients?pageSize=10&page=2').expect(200);
      expect(p1.body.total).toBeGreaterThan(300);
      expect(p1.body.items).toHaveLength(10);
      expect(p2.body.items[0].id).not.toBe(p1.body.items[0].id);
    });
  });

  describe('dodawanie i akceptacja', () => {
    it('gość i użytkownik bez potwierdzonego maila nie mogą dodawać', async () => {
      await t.api().post('/api/ingredients').send(NEW_INGREDIENT).expect(401);
      const unverified = await t.login('niepotwierdzony', { verified: false });
      const res = await t
        .api()
        .post('/api/ingredients')
        .set(bearer(unverified))
        .send(NEW_INGREDIENT)
        .expect(403);
      expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    });

    it('składnik użytkownika czeka na akceptację i widzi go tylko autor', async () => {
      const kasia = await t.login('kasia');
      const ola = await t.login('ola');

      const created = await t
        .api()
        .post('/api/ingredients')
        .set(bearer(kasia))
        .send(NEW_INGREDIENT)
        .expect(201);
      expect(created.body).toMatchObject({ status: 'PENDING', source: 'USER', isOwn: true, canEdit: true });
      const id = created.body.id as string;

      // Autor widzi go w wyszukiwarce i w "moich"
      const own = await t.api().get('/api/ingredients?q=twarog').set(bearer(kasia)).expect(200);
      expect(own.body.items.map((i: { id: string }) => i.id)).toContain(id);
      const mine = await t.api().get('/api/ingredients?mine=true').set(bearer(kasia)).expect(200);
      expect(mine.body.total).toBe(1);

      // Inni - nie, a bezpośredni link udaje, że składnik nie istnieje
      const other = await t.api().get('/api/ingredients?q=twarog').set(bearer(ola)).expect(200);
      expect(other.body.items.map((i: { id: string }) => i.id)).not.toContain(id);
      await t.api().get(`/api/ingredients/${id}`).expect(404);
      await t.api().get(`/api/ingredients/${id}`).set(bearer(ola)).expect(404);
    });

    it('admin akceptuje - składnik staje się publiczny, autor nie może go już edytować', async () => {
      const kasia = await t.login('kasia');
      const admin = await t.login('szef', { role: 'ADMIN' });
      const { body } = await t
        .api()
        .post('/api/ingredients')
        .set(bearer(kasia))
        .send(NEW_INGREDIENT)
        .expect(201);

      const queue = await t.api().get('/api/ingredients?status=PENDING').set(bearer(admin)).expect(200);
      expect(queue.body.items.map((i: { id: string }) => i.id)).toContain(body.id);

      await t.api().post(`/api/ingredients/${body.id}/approve`).set(bearer(kasia)).expect(403);
      const approved = await t
        .api()
        .post(`/api/ingredients/${body.id}/approve`)
        .set(bearer(admin))
        .expect(200);
      expect(approved.body.status).toBe('APPROVED');

      const pub = await t.api().get(`/api/ingredients/${body.id}`).expect(200);
      expect(pub.body.createdBy).toEqual({ username: 'kasia' });
      const asAuthor = await t.api().get(`/api/ingredients/${body.id}`).set(bearer(kasia)).expect(200);
      expect(asAuthor.body.canEdit).toBe(false);
      await t.api().patch(`/api/ingredients/${body.id}`).set(bearer(kasia)).send(NEW_INGREDIENT).expect(403);
      await t.api().delete(`/api/ingredients/${body.id}`).set(bearer(kasia)).expect(403);
    });

    it('odrzucenie z powodem; poprawka autora wraca do kolejki', async () => {
      const kasia = await t.login('kasia');
      const admin = await t.login('szef', { role: 'ADMIN' });
      const { body } = await t
        .api()
        .post('/api/ingredients')
        .set(bearer(kasia))
        .send(NEW_INGREDIENT)
        .expect(201);

      const rejected = await t
        .api()
        .post(`/api/ingredients/${body.id}/reject`)
        .set(bearer(admin))
        .send({ reason: 'Podaj źródło wartości odżywczych' })
        .expect(200);
      expect(rejected.body.status).toBe('REJECTED');

      const seen = await t.api().get(`/api/ingredients/${body.id}`).set(bearer(kasia)).expect(200);
      expect(seen.body.rejectionReason).toBe('Podaj źródło wartości odżywczych');

      const fixed = await t
        .api()
        .patch(`/api/ingredients/${body.id}`)
        .set(bearer(kasia))
        .send({ ...NEW_INGREDIENT, kcal: 132 })
        .expect(200);
      expect(fixed.body).toMatchObject({ status: 'PENDING', rejectionReason: null });
      expect(fixed.body.nutrition.kcal).toBe(132);
    });

    it('admin dodaje od razu zatwierdzony składnik', async () => {
      const admin = await t.login('szef', { role: 'ADMIN' });
      const res = await t.api().post('/api/ingredients').set(bearer(admin)).send(NEW_INGREDIENT).expect(201);
      expect(res.body.status).toBe('APPROVED');
    });

    it('blokuje duplikat zatwierdzonej nazwy (bez względu na wielkość liter)', async () => {
      const kasia = await t.login('kasia');
      const res = await t
        .api()
        .post('/api/ingredients')
        .set(bearer(kasia))
        .send({ ...NEW_INGREDIENT, namePl: 'POMIDOR' })
        .expect(409);
      expect(res.body.code).toBe('INGREDIENT_EXISTS');
      expect(res.body.id).toBeTruthy();
    });

    it('waliduje wartości odżywcze, alergeny, jednostki i nazwę', async () => {
      const kasia = await t.login('kasia');
      const post = (body: object) => t.api().post('/api/ingredients').set(bearer(kasia)).send(body);

      expect((await post({ ...NEW_INGREDIENT, protein: 60, fat: 50 }).expect(400)).body.code).toBe(
        'NUTRITION_OVER_100G',
      );
      expect((await post({ ...NEW_INGREDIENT, saturatedFat: 9 }).expect(400)).body.code).toBe(
        'NUTRITION_SATFAT_GT_FAT',
      );
      expect((await post({ ...NEW_INGREDIENT, allergens: ['ORZECHY'] }).expect(400)).body.code).toBe(
        'ALLERGEN_UNKNOWN',
      );
      expect(
        (await post({ ...NEW_INGREDIENT, units: [{ code: 'BECZKA', grams: 1 }] }).expect(400)).body.code,
      ).toBe('UNIT_UNKNOWN');
      expect((await post({ ...NEW_INGREDIENT, namePl: 'Kurwa mać' }).expect(400)).body.code).toBe(
        'NAME_OFFENSIVE',
      );
      await post({ ...NEW_INGREDIENT, kcal: -5 }).expect(400);
      await post({ ...NEW_INGREDIENT, status: 'APPROVED' }).expect(400); // nie da się nadać statusu samemu
    });

    it('autor może usunąć niezatwierdzony składnik', async () => {
      const kasia = await t.login('kasia');
      const { body } = await t
        .api()
        .post('/api/ingredients')
        .set(bearer(kasia))
        .send(NEW_INGREDIENT)
        .expect(201);
      await t.api().delete(`/api/ingredients/${body.id}`).set(bearer(kasia)).expect(204);
      await t.api().get(`/api/ingredients/${body.id}`).set(bearer(kasia)).expect(404);
    });
  });
});
