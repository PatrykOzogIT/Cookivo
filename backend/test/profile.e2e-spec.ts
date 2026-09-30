import { createTestApp } from './support/app.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const PASSWORD = 'Zielony-Kalafior-Tańczy-42';

const PROFILE = {
  sex: 'FEMALE',
  birthDate: '1996-01-15',
  heightCm: 165,
  weightKg: 60,
  activity: 'MODERATE',
  goal: 'MAINTAIN',
};

describe('Profil, preferencje i konto (e2e)', () => {
  let t: TestApp;
  let me: string;
  let ids: Record<string, string>;

  beforeAll(async () => {
    t = await createTestApp();
    const byName = async (namePl: string) =>
      (await t.prisma.ingredient.findFirstOrThrow({ where: { namePl, source: 'USDA' } })).id;
    ids = {
      egg: await byName('Jajko'),
      salmon: await byName('Łosoś (hodowlany)'),
      cod: await byName('Dorsz'),
      flour: await byName('Mąka pszenna'),
      carrot: await byName('Marchew'),
    };
  });

  beforeEach(async () => {
    await t.prisma.recipeIngredient.deleteMany();
    await t.prisma.recipe.deleteMany();
    await t.prisma.photo.deleteMany();
    await t.prisma.ingredient.deleteMany({ where: { source: 'USER' } });
    await t.prisma.user.deleteMany();
    t.mails.length = 0;
    me = await t.login('kasia');
  });

  afterAll(async () => {
    await t.app.close();
  });

  const api = () => t.api();

  describe('profil żywieniowy i zgoda na dane o zdrowiu', () => {
    it('bez zgody nie da się zapisać profilu ani alergii', async () => {
      const res = await api().put('/api/me/profile').set(bearer(me)).send(PROFILE).expect(403);
      expect(res.body.code).toBe('HEALTH_CONSENT_REQUIRED');
      await api()
        .put('/api/me/allergens')
        .set(bearer(me))
        .send({ allergens: [{ code: 'GLUTEN', severity: 'ALLERGY' }] })
        .expect(403);
    });

    it('po zgodzie zapisuje profil i zwraca wyliczony cel', async () => {
      await api().post('/api/me/consents/health-data').set(bearer(me)).send({ granted: true }).expect(200);
      const res = await api().put('/api/me/profile').set(bearer(me)).send(PROFILE).expect(200);
      expect(res.body.healthConsent).toBe(true);
      expect(res.body.profile).toMatchObject({ ...PROFILE });
      expect(res.body.targets).toMatchObject({ kcal: 2050, protein: 96, custom: false });

      const custom = await api()
        .put('/api/me/profile')
        .set(bearer(me))
        .send({ ...PROFILE, goal: 'CUT', customProtein: 140 })
        .expect(200);
      expect(custom.body.targets).toMatchObject({ kcal: 1640, protein: 140, custom: true });

      const consents = await t.prisma.consent.findMany({ where: { type: 'HEALTH_DATA' } });
      expect(consents).toHaveLength(1);
    });

    it('odrzuca osoby niepełnoletnie (wzór jest dla dorosłych)', async () => {
      await api().post('/api/me/consents/health-data').set(bearer(me)).send({ granted: true }).expect(200);
      const year = new Date().getFullYear() - 15;
      const res = await api()
        .put('/api/me/profile')
        .set(bearer(me))
        .send({ ...PROFILE, birthDate: `${year}-01-01` })
        .expect(400);
      expect(res.body.code).toBe('AGE_OUT_OF_RANGE');
    });

    it('wycofanie zgody usuwa profil i alergie, historia zgód zostaje', async () => {
      await api().post('/api/me/consents/health-data').set(bearer(me)).send({ granted: true }).expect(200);
      await api().put('/api/me/profile').set(bearer(me)).send(PROFILE).expect(200);
      await api()
        .put('/api/me/allergens')
        .set(bearer(me))
        .send({ allergens: [{ code: 'MILK', severity: 'INTOLERANCE' }] })
        .expect(200);

      const res = await api()
        .post('/api/me/consents/health-data')
        .set(bearer(me))
        .send({ granted: false })
        .expect(200);
      expect(res.body).toMatchObject({ healthConsent: false, profile: null, targets: null, allergens: [] });
      const history = await t.prisma.consent.findMany({ where: { type: 'HEALTH_DATA' } });
      expect(history).toHaveLength(1);
      expect(history[0].revokedAt).not.toBeNull();
    });
  });

  describe('alergie i preferencje w listach', () => {
    const recipe = (title: string, lines: { ingredientId: string; amount: number; unitCode: string }[]) => ({
      title,
      servings: 1,
      visibility: 'PUBLIC',
      canBeIngredient: false,
      mealTypes: [],
      ingredients: lines,
      steps: [],
      photoIds: [],
    });

    it('forMe ukrywa przepisy z moimi alergenami i "nie proponuj"; forYou sortuje wg upodobań', async () => {
      const author = await t.login('autor');
      const post = (body: object) => api().post('/api/recipes').set(bearer(author)).send(body).expect(201);
      await post(recipe('Omlet', [{ ingredientId: ids.egg, amount: 2, unitCode: 'PIECE' }]));
      await post(recipe('Łosoś pieczony', [{ ingredientId: ids.salmon, amount: 200, unitCode: 'g' }]));
      await post(
        recipe('Dorsz z marchewką', [
          { ingredientId: ids.cod, amount: 200, unitCode: 'g' },
          { ingredientId: ids.carrot, amount: 100, unitCode: 'g' },
        ]),
      );
      await post(recipe('Marchewka', [{ ingredientId: ids.carrot, amount: 200, unitCode: 'g' }]));

      await api().post('/api/me/consents/health-data').set(bearer(me)).send({ granted: true }).expect(200);
      await api()
        .put('/api/me/allergens')
        .set(bearer(me))
        .send({ allergens: [{ code: 'EGGS', severity: 'ALLERGY' }] })
        .expect(200);
      // Ryby: nie proponuj - ale łosoś: bardzo lubię (składnik wygrywa z kategorią)
      await api()
        .put('/api/me/preferences/categories/FISH')
        .set(bearer(me))
        .send({ level: 'NEVER' })
        .expect(200);
      await api()
        .put(`/api/me/preferences/ingredients/${ids.salmon}`)
        .set(bearer(me))
        .send({ level: 'LOVE' })
        .expect(200);

      const titles = async (qs: string) =>
        (await api().get(`/api/recipes?${qs}`).set(bearer(me)).expect(200)).body.items.map(
          (r: { title: string }) => r.title,
        );
      expect(await titles('forMe=true&sort=forYou')).toEqual(['Łosoś pieczony', 'Marchewka']);

      // Bez filtra widać wszystko, a omlet ma ostrzeżenie o moim alergenie
      const all = (await api().get('/api/recipes').set(bearer(me)).expect(200)).body.items;
      const omlet = all.find((r: { title: string }) => r.title === 'Omlet');
      expect(omlet.myAllergens).toEqual(['EGGS']);
    });

    it('składniki: forMe filtruje, a karta pokazuje moje preferencje', async () => {
      // Bez żadnych preferencji forMe niczego nie ukrywa (regresja: NOT NULL w SQL)
      const all = (await api().get('/api/ingredients?category=FISH&pageSize=50').set(bearer(me)).expect(200))
        .body;
      const allForMe = (
        await api().get('/api/ingredients?category=FISH&forMe=true&pageSize=50').set(bearer(me)).expect(200)
      ).body;
      expect(allForMe.total).toBe(all.total);
      expect(all.total).toBeGreaterThan(1);

      await api()
        .put('/api/me/preferences/categories/FISH')
        .set(bearer(me))
        .send({ level: 'NEVER' })
        .expect(200);
      await api()
        .put(`/api/me/preferences/ingredients/${ids.salmon}`)
        .set(bearer(me))
        .send({ level: 'LIKE' })
        .expect(200);

      const fish = (
        await api().get('/api/ingredients?category=FISH&forMe=true&pageSize=50').set(bearer(me)).expect(200)
      ).body.items;
      expect(fish.map((i: { namePl: string }) => i.namePl)).toEqual(['Łosoś (hodowlany)']);
      expect(fish[0].personal).toEqual({ preference: 'LIKE', categoryPreference: 'NEVER', myAllergens: [] });

      const prefs = (await api().get('/api/me/preferences').set(bearer(me)).expect(200)).body;
      expect(prefs.categories).toEqual([{ code: 'FISH', level: 'NEVER' }]);
      expect(prefs.ingredients.map((i: { namePl: string; level: string }) => [i.namePl, i.level])).toEqual([
        ['Łosoś (hodowlany)', 'LIKE'],
      ]);

      // null = neutralnie (usuwa preferencję)
      await api()
        .put(`/api/me/preferences/ingredients/${ids.salmon}`)
        .set(bearer(me))
        .send({ level: null })
        .expect(200);
      expect((await api().get('/api/me/preferences').set(bearer(me)).expect(200)).body.ingredients).toEqual(
        [],
      );
    });
  });

  describe('ustawienia konta', () => {
    it('zmiana hasła wymaga starego hasła i wylogowuje inne urządzenia', async () => {
      // Bieżące urządzenie: token dostępu i ciasteczko z tej samej sesji
      const first = await api()
        .post('/api/auth/login')
        .send({ login: 'kasia', password: PASSWORD })
        .expect(200);
      const firstToken = first.body.accessToken as string;
      const firstCookie = ([] as string[]).concat(first.headers['set-cookie'] ?? [])[0].split(';')[0];
      const second = await api()
        .post('/api/auth/login')
        .send({ login: 'kasia', password: PASSWORD })
        .expect(200);
      const secondCookie = ([] as string[]).concat(second.headers['set-cookie'] ?? [])[0].split(';')[0];

      await api()
        .post('/api/me/password')
        .set(bearer(me))
        .send({ currentPassword: 'zle-haslo', newPassword: 'Nowe-Haslo-Pietruszka-2026' })
        .expect(400);
      await api()
        .post('/api/me/password')
        .set(bearer(firstToken))
        .send({ currentPassword: PASSWORD, newPassword: 'Nowe-Haslo-Pietruszka-2026' })
        .expect(204);

      await api().post('/api/auth/refresh').set('Cookie', secondCookie).expect(401);
      // Sesja, z której zmieniono hasło, zostaje
      await api().post('/api/auth/refresh').set('Cookie', firstCookie).expect(200);
      await api()
        .post('/api/auth/login')
        .send({ login: 'kasia', password: 'Nowe-Haslo-Pietruszka-2026' })
        .expect(200);
      expect(t.mails.at(-1)?.kind).toBe('passwordChanged');
    });

    it('zmiana maila: link na nowy adres, powiadomienie na stary', async () => {
      await api()
        .post('/api/me/email')
        .set(bearer(me))
        .send({ newEmail: 'nowa@example.com', password: PASSWORD })
        .expect(202);
      const link = t.mails.find((m) => m.kind === 'changeEmail');
      expect(link?.to).toBe('nowa@example.com');
      expect(t.mails.find((m) => m.kind === 'emailChangeRequested')?.to).toBe('kasia@example.com');

      const token = new URL(link!.url!).searchParams.get('token');
      await api().post('/api/auth/confirm-email-change').send({ token }).expect(204);
      const me2 = (await api().get('/api/auth/me').set(bearer(me)).expect(200)).body;
      expect(me2.email).toBe('nowa@example.com');
      await api().post('/api/auth/confirm-email-change').send({ token }).expect(400);
    });

    it('lista urządzeń i wylogowanie wybranego', async () => {
      await api().post('/api/auth/login').send({ login: 'kasia', password: PASSWORD }).expect(200);
      const sessions = (await api().get('/api/me/sessions').set(bearer(me)).expect(200)).body;
      expect(sessions.length).toBe(2);
      // Bieżące urządzenie rozpoznane po tokenie (ciasteczko ma ścieżkę /api/auth i tu nie dociera)
      const current = sessions.filter((x: { current: boolean }) => x.current);
      expect(current).toHaveLength(1);
      const other = sessions.find((x: { current: boolean }) => !x.current);
      await api().delete(`/api/me/sessions/${other.id}`).set(bearer(me)).expect(204);
      const left = (await api().get('/api/me/sessions').set(bearer(me)).expect(200)).body;
      expect(left).toHaveLength(1);
      expect(left[0].current).toBe(true);

      await api().post('/api/auth/login').send({ login: 'kasia', password: PASSWORD }).expect(200);
      await api().delete('/api/me/sessions').set(bearer(me)).expect(204);
      const afterAll = (await api().get('/api/me/sessions').set(bearer(me)).expect(200)).body;
      expect(afterAll.map((x: { id: string }) => x.id)).toEqual([current[0].id]);
    });

    it('zmiana języka', async () => {
      const res = await api().patch('/api/me/settings').set(bearer(me)).send({ locale: 'en' }).expect(200);
      expect(res.body.locale).toBe('en');
    });
  });

  describe('RODO', () => {
    it('eksport zawiera konto, zgody, profil, preferencje i przepisy', async () => {
      await api().post('/api/me/consents/health-data').set(bearer(me)).send({ granted: true }).expect(200);
      await api().put('/api/me/profile').set(bearer(me)).send(PROFILE).expect(200);
      await api()
        .post('/api/recipes')
        .set(bearer(me))
        .send({
          title: 'Mój przepis',
          servings: 1,
          visibility: 'PRIVATE',
          canBeIngredient: false,
          mealTypes: [],
          ingredients: [{ ingredientId: ids.carrot, amount: 100, unitCode: 'g' }],
          steps: [{ text: 'Umyj.' }],
          photoIds: [],
        })
        .expect(201);

      const res = await api().get('/api/me/export').set(bearer(me)).expect(200);
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="cookivo-dane-/);
      expect(res.body.account).toMatchObject({ username: 'kasia', email: 'kasia@example.com' });
      expect(res.body.consents.map((c: { type: string }) => c.type)).toEqual([
        'TERMS',
        'PRIVACY_POLICY',
        'HEALTH_DATA',
      ]);
      expect(res.body.nutritionProfile).toMatchObject({ sex: 'FEMALE' });
      expect(res.body.recipes[0]).toMatchObject({ title: 'Mój przepis', steps: ['Umyj.'] });
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
      expect(JSON.stringify(res.body)).not.toMatch(/\$argon2/);
    });

    it('usunięcie konta: publiczne przepisy anonimowe, prywatne i dane osobowe znikają', async () => {
      const make = (title: string, visibility: string) =>
        api()
          .post('/api/recipes')
          .set(bearer(me))
          .send({
            title,
            servings: 1,
            visibility,
            canBeIngredient: false,
            mealTypes: [],
            ingredients: [{ ingredientId: ids.carrot, amount: 100, unitCode: 'g' }],
            steps: [],
            photoIds: [],
          })
          .expect(201);
      const pub = (await make('Publiczny', 'PUBLIC')).body;
      const priv = (await make('Prywatny', 'PRIVATE')).body;

      await api().post('/api/me/delete').set(bearer(me)).send({ password: 'zle' }).expect(400);
      await api().post('/api/me/delete').set(bearer(me)).send({ password: PASSWORD }).expect(204);

      expect(await t.prisma.user.findUnique({ where: { email: 'kasia@example.com' } })).toBeNull();
      const anon = (await api().get(`/api/recipes/${pub.id}`).expect(200)).body;
      expect(anon.author).toBeNull();
      expect(await t.prisma.recipe.findUnique({ where: { id: priv.id } })).toBeNull();
      expect(t.mails.at(-1)).toMatchObject({ kind: 'accountDeleted', to: 'kasia@example.com' });
      await api().get('/api/auth/me').set(bearer(me)).expect(401);
    });
  });
});
