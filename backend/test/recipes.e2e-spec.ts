import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { PhotosService } from '../src/photos/photos.service.js';
import { createTestApp } from './support/app.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Przepisy (e2e)', () => {
  let t: TestApp;
  let ids: Record<string, string>;
  let author: string;
  let other: string;
  let admin: string;

  /** Minimalny poprawny przepis */
  const recipe = (overrides: Record<string, unknown> = {}) => ({
    title: 'Naleśniki',
    servings: 4,
    visibility: 'PUBLIC',
    canBeIngredient: false,
    mealTypes: ['BREAKFAST'],
    ingredients: [
      { ingredientId: ids.egg, amount: 2, unitCode: 'PIECE' }, // 100 g
      { ingredientId: ids.milk, amount: 1, unitCode: 'GLASS' }, // 250 ml × 1,03
      { ingredientId: ids.flour, amount: 150, unitCode: 'g' },
    ],
    steps: [{ text: 'Zmiksuj wszystko.' }, { text: 'Smaż z obu stron.', timerMinutes: 2 }],
    photoIds: [],
    ...overrides,
  });

  const post = (token: string, body: object) => t.api().post('/api/recipes').set(bearer(token)).send(body);

  beforeAll(async () => {
    t = await createTestApp();
    const byName = async (namePl: string) =>
      (await t.prisma.ingredient.findFirstOrThrow({ where: { namePl, source: 'USDA' } })).id;
    ids = {
      egg: await byName('Jajko'),
      milk: await byName('Mleko 3,2%'),
      flour: await byName('Mąka pszenna'),
      celery: await byName('Seler naciowy'),
      carrot: await byName('Marchew'),
      water: await byName('Woda'),
      chicken: await byName('Pierś z kurczaka'),
    };
  });

  beforeEach(async () => {
    await t.prisma.recipeIngredient.deleteMany();
    await t.prisma.recipe.deleteMany();
    await t.prisma.photo.deleteMany();
    await t.prisma.ingredient.deleteMany({ where: { source: 'USER' } });
    await t.prisma.user.deleteMany();
    author = await t.login('autorka');
    other = await t.login('ktos_inny');
    admin = await t.login('szef', { role: 'ADMIN' });
  });

  afterAll(async () => {
    await t.prisma.recipeIngredient.deleteMany();
    await t.prisma.recipe.deleteMany();
    await t.prisma.photo.deleteMany();
    await t.app.close();
  });

  describe('wyliczenia', () => {
    it('liczy gramaturę jednostek, sumy, porcje i alergeny ze składników', async () => {
      const res = await post(author, recipe()).expect(201);
      const r = res.body;

      const [egg, milk, flour] = r.ingredients;
      expect(egg.grams).toBe(100);
      expect(milk.grams).toBeCloseTo(257.5, 1);
      expect(flour.grams).toBe(150);
      expect(r.totalGrams).toBeCloseTo(507.5, 1);

      // 143 (jajko) + 61 × 2,575 (mleko) + 364 × 1,5 (mąka)
      expect(r.nutrition.total.kcal).toBeCloseTo(143 + 157.1 + 546, 0);
      expect(r.nutrition.perServing.kcal).toBeCloseTo(r.nutrition.total.kcal / 4, 0);
      expect(r.kcalPerServing).toBeCloseTo(r.nutrition.total.kcal / 4, 0);
      expect(r.nutrition.approximate).toBe(true);
      expect(r.allergens.map((a: { code: string }) => a.code).sort()).toEqual(['EGGS', 'GLUTEN', 'MILK']);
      expect(r.mealTypes).toEqual([
        { code: 'BREAKFAST', namePl: 'Śniadanie', nameEn: 'Breakfast', icon: 'egg_alt' },
      ]);
      expect(r.steps[1]).toMatchObject({ text: 'Smaż z obu stron.', timerMinutes: 2 });
    });

    it('waga po ugotowaniu daje dokładne wartości na 100 g, nie zmieniając porcji', async () => {
      const approx = (await post(author, recipe()).expect(201)).body;
      const exact = (await post(author, recipe({ cookedGrams: 400 })).expect(201)).body;

      expect(exact.nutrition.approximate).toBe(false);
      expect(exact.nutrition.perServing.kcal).toBe(approx.nutrition.perServing.kcal);
      expect(exact.nutrition.servingGrams).toBe(100);
      expect(exact.nutrition.per100g.kcal).toBeCloseTo((approx.nutrition.total.kcal * 100) / 400, 0);
    });

    it('odrzuca jednostkę, której nie da się przeliczyć, wskazując pozycję', async () => {
      const res = await post(
        author,
        recipe({ ingredients: [{ ingredientId: ids.flour, amount: 1, unitCode: 'ml' }] }),
      ).expect(400);
      expect(res.body).toMatchObject({ code: 'UNIT_NOT_ALLOWED', index: 0 });
    });

    it('po zmianie składnika przez admina przelicza przepisy, które go używają', async () => {
      const r = (await post(author, recipe()).expect(201)).body;
      const flour = (await t.api().get(`/api/ingredients/${ids.flour}`).expect(200)).body;
      const payload = {
        namePl: flour.namePl,
        nameEn: flour.nameEn,
        categoryCode: flour.category.code,
        ...flour.nutrition,
        kcal: flour.nutrition.kcal + 100, // +100 kcal/100 g → +150 kcal w przepisie
        density: flour.density,
        allergens: flour.allergens.map((a: { code: string }) => a.code),
        units: flour.units.map((u: { code: string; grams: number }) => ({ code: u.code, grams: u.grams })),
      };
      await t.api().patch(`/api/ingredients/${ids.flour}`).set(bearer(admin)).send(payload).expect(200);

      const after = (await t.api().get(`/api/recipes/${r.id}`).expect(200)).body;
      expect(after.nutrition.total.kcal).toBeCloseTo(r.nutrition.total.kcal + 150, 0);

      // przywracamy seed dla kolejnych testów
      await t
        .api()
        .patch(`/api/ingredients/${ids.flour}`)
        .set(bearer(admin))
        .send({ ...payload, kcal: flour.nutrition.kcal })
        .expect(200);
    });
  });

  describe('podprzepisy', () => {
    const broth = (overrides: Record<string, unknown> = {}) =>
      recipe({
        title: 'Rosół',
        servings: 4,
        canBeIngredient: true,
        cookedGrams: 2000,
        mealTypes: ['DINNER'],
        ingredients: [
          { ingredientId: ids.chicken, amount: 500, unitCode: 'g' },
          { ingredientId: ids.celery, amount: 100, unitCode: 'g' },
          { ingredientId: ids.water, amount: 2000, unitCode: 'ml' },
        ],
        ...overrides,
      });

    it('używa porcji podprzepisu i przenosi jego alergeny w górę', async () => {
      const b = (await post(author, broth()).expect(201)).body;
      const soup = (
        await post(
          author,
          recipe({
            title: 'Zupa jarzynowa',
            servings: 2,
            ingredients: [
              { subRecipeId: b.id, amount: 1, unitCode: 'SERVING' }, // 2000 g / 4 = 500 g
              { ingredientId: ids.carrot, amount: 100, unitCode: 'g' },
            ],
          }),
        ).expect(201)
      ).body;

      expect(soup.ingredients[0]).toMatchObject({ grams: 500, subRecipe: { id: b.id, title: 'Rosół' } });
      expect(soup.allergens.map((a: { code: string }) => a.code)).toContain('CELERY');
      // 1/4 wartości rosołu + marchew (41 kcal/100 g)
      expect(soup.nutrition.total.kcal).toBeCloseTo(b.nutrition.total.kcal / 4 + 41, 0);
    });

    it('zmiana podprzepisu przelicza przepisy, które go używają', async () => {
      const b = (await post(author, broth()).expect(201)).body;
      const soup = (
        await post(
          author,
          recipe({ title: 'Zupa', ingredients: [{ subRecipeId: b.id, amount: 2, unitCode: 'SERVING' }] }),
        ).expect(201)
      ).body;

      await t
        .api()
        .patch(`/api/recipes/${b.id}`)
        .set(bearer(author))
        .send(
          broth({
            ingredients: [...broth().ingredients, { ingredientId: ids.egg, amount: 2, unitCode: 'PIECE' }],
          }),
        )
        .expect(200);

      const after = (await t.api().get(`/api/recipes/${soup.id}`).expect(200)).body;
      expect(after.allergens.map((a: { code: string }) => a.code)).toContain('EGGS');
      expect(after.nutrition.total.kcal).toBeGreaterThan(soup.nutrition.total.kcal);
    });

    it('blokuje zapętlenie i przepisy nieoznaczone jako składnik', async () => {
      const b = (await post(author, broth()).expect(201)).body;
      const soup = (
        await post(
          author,
          recipe({
            title: 'Zupa',
            canBeIngredient: true,
            ingredients: [{ subRecipeId: b.id, amount: 1, unitCode: 'SERVING' }],
          }),
        ).expect(201)
      ).body;

      const cycle = await t
        .api()
        .patch(`/api/recipes/${b.id}`)
        .set(bearer(author))
        .send(broth({ ingredients: [{ subRecipeId: soup.id, amount: 1, unitCode: 'SERVING' }] }))
        .expect(400);
      expect(cycle.body.code).toBe('RECIPE_CYCLE');

      const plain = (await post(author, recipe({ title: 'Zwykły' })).expect(201)).body;
      const notAllowed = await post(
        author,
        recipe({ ingredients: [{ subRecipeId: plain.id, amount: 1, unitCode: 'SERVING' }] }),
      ).expect(400);
      expect(notAllowed.body.code).toBe('SUBRECIPE_NOT_ALLOWED');
    });

    it('nie pozwala usunąć ani wyłączyć podprzepisu, który jest używany', async () => {
      const b = (await post(author, broth()).expect(201)).body;
      await post(
        author,
        recipe({ ingredients: [{ subRecipeId: b.id, amount: 1, unitCode: 'SERVING' }] }),
      ).expect(201);
      expect((await t.api().delete(`/api/recipes/${b.id}`).set(bearer(author)).expect(409)).body.code).toBe(
        'RECIPE_IN_USE',
      );
      await t
        .api()
        .patch(`/api/recipes/${b.id}`)
        .set(bearer(author))
        .send(broth({ canBeIngredient: false }))
        .expect(409);
    });

    it('przepis publiczny nie może używać cudzego prywatnego podprzepisu', async () => {
      const privateBroth = (await post(other, broth({ visibility: 'PRIVATE' })).expect(201)).body;
      const res = await post(
        author,
        recipe({ ingredients: [{ subRecipeId: privateBroth.id, amount: 1, unitCode: 'SERVING' }] }),
      ).expect(400);
      expect(res.body.code).toBe('SUBRECIPE_UNKNOWN');
    });
  });

  describe('widoczność i lista', () => {
    it('prywatny widzi tylko autor; publiczny każdy, także gość', async () => {
      const priv = (await post(author, recipe({ visibility: 'PRIVATE', title: 'Tajny' })).expect(201)).body;
      const pub = (await post(author, recipe({ title: 'Jawny' })).expect(201)).body;

      await t.api().get(`/api/recipes/${priv.id}`).expect(404);
      await t.api().get(`/api/recipes/${priv.id}`).set(bearer(other)).expect(404);
      await t.api().get(`/api/recipes/${priv.id}`).set(bearer(author)).expect(200);
      await t.api().get(`/api/recipes/${pub.id}`).expect(200);

      const guestList = (await t.api().get('/api/recipes').expect(200)).body;
      expect(guestList.items.map((r: { title: string }) => r.title)).toEqual(['Jawny']);
      const mine = (await t.api().get('/api/recipes?mine=true').set(bearer(author)).expect(200)).body;
      expect(mine.total).toBe(2);
    });

    it('filtruje po typie posiłku, alergenach, kaloriach i wyszukuje bez polskich znaków', async () => {
      await post(author, recipe({ title: 'Naleśniki z serem', mealTypes: ['BREAKFAST'] })).expect(201);
      await post(
        author,
        recipe({
          title: 'Marchewka gotowana',
          mealTypes: ['DINNER'],
          ingredients: [{ ingredientId: ids.carrot, amount: 200, unitCode: 'g' }],
        }),
      ).expect(201);

      const titles = async (qs: string) =>
        (await t.api().get(`/api/recipes?${qs}`).expect(200)).body.items.map(
          (r: { title: string }) => r.title,
        );

      expect(await titles('mealTypes=DINNER')).toEqual(['Marchewka gotowana']);
      expect(await titles('excludeAllergens=GLUTEN')).toEqual(['Marchewka gotowana']);
      expect(await titles('maxKcal=50')).toEqual(['Marchewka gotowana']);
      expect(await titles('q=nalesniki')).toEqual(['Naleśniki z serem']);
      expect(await titles('sort=kcal')).toEqual(['Marchewka gotowana', 'Naleśniki z serem']);
    });

    it('publiczny przepis nie może zawierać niezatwierdzonego składnika (prywatny może)', async () => {
      const pending = (
        await t
          .api()
          .post('/api/ingredients')
          .set(bearer(author))
          .send({ namePl: 'Mój twaróg', categoryCode: 'DAIRY', kcal: 133, protein: 18, fat: 5, carbs: 4 })
          .expect(201)
      ).body;
      const line = [{ ingredientId: pending.id, amount: 100, unitCode: 'g' }];
      expect((await post(author, recipe({ ingredients: line })).expect(400)).body.code).toBe(
        'INGREDIENT_NOT_APPROVED',
      );
      await post(author, recipe({ visibility: 'PRIVATE', ingredients: line })).expect(201);
    });

    it('admin ukrywa przepis: znika dla innych, autor widzi powód', async () => {
      const r = (await post(author, recipe()).expect(201)).body;
      await t.api().post(`/api/recipes/${r.id}/hide`).set(bearer(other)).send({ reason: 'xxx' }).expect(403);
      await t
        .api()
        .post(`/api/recipes/${r.id}/hide`)
        .set(bearer(admin))
        .send({ reason: 'Zdjęcie nie przedstawia potrawy' })
        .expect(200);

      await t.api().get(`/api/recipes/${r.id}`).expect(404);
      expect((await t.api().get('/api/recipes').expect(200)).body.total).toBe(0);
      const seen = (await t.api().get(`/api/recipes/${r.id}`).set(bearer(author)).expect(200)).body;
      expect(seen).toMatchObject({ hidden: true, hiddenReason: 'Zdjęcie nie przedstawia potrawy' });
    });

    it('odrzuca wulgaryzmy, nieznane typy posiłków i cudzą edycję', async () => {
      expect((await post(author, recipe({ title: 'Kurwa mać' })).expect(400)).body.code).toBe(
        'CONTENT_OFFENSIVE',
      );
      expect((await post(author, recipe({ mealTypes: ['BRUNCH'] })).expect(400)).body.code).toBe(
        'MEAL_TYPE_UNKNOWN',
      );
      const r = (await post(author, recipe()).expect(201)).body;
      await t.api().patch(`/api/recipes/${r.id}`).set(bearer(other)).send(recipe()).expect(403);
      await t.api().delete(`/api/recipes/${r.id}`).set(bearer(other)).expect(403);
    });
  });

  describe('zdjęcia', () => {
    const jpegWithGps = () =>
      sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#e8704a' } })
        .jpeg()
        .withExif({
          IFD0: { Make: 'TestPhone' },
          IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '52/1 13/1 0/1' },
        })
        .toBuffer();

    const upload = async (token: string, buffer: Buffer, name = 'photo.jpg') =>
      t.api().post('/api/photos').set(bearer(token)).attach('file', buffer, name);

    it('zapisuje WebP w trzech rozmiarach bez metadanych (GPS)', async () => {
      const res = await upload(author, await jpegWithGps());
      expect(res.status).toBe(201);
      expect(res.body.width).toBe(1600);
      expect(res.body.height).toBe(1067);

      const small = await t.api().get(res.body.urls.small).expect(200);
      expect(small.headers['content-type']).toBe('image/webp');
      const meta = await sharp(small.body as Buffer).metadata();
      expect(meta.width).toBe(400);
      expect(meta.exif).toBeUndefined();
    });

    it('przypina zdjęcia do przepisu i usuwa pliki zdjęć usuniętych z przepisu', async () => {
      const cover = (await upload(author, await jpegWithGps())).body;
      const step = (await upload(author, await jpegWithGps())).body;
      const r = (
        await post(
          author,
          recipe({ photoIds: [cover.id], steps: [{ text: 'Krok ze zdjęciem', photoId: step.id }] }),
        ).expect(201)
      ).body;
      expect(r.cover.id).toBe(cover.id);
      expect(r.steps[0].photo.id).toBe(step.id);

      // Inny użytkownik nie może "pożyczyć" cudzego zdjęcia
      expect((await post(other, recipe({ photoIds: [cover.id] })).expect(400)).body.code).toBe(
        'PHOTO_INVALID',
      );

      await t
        .api()
        .patch(`/api/recipes/${r.id}`)
        .set(bearer(author))
        .send(recipe({ photoIds: [] }))
        .expect(200);
      const dir = t.app.get(PhotosService).dir;
      expect(existsSync(join(dir, `${cover.id}-400.webp`))).toBe(false);
      expect(existsSync(join(dir, `${step.id}-400.webp`))).toBe(false);
    });

    it('odrzuca pliki powyżej 5 MB i nie-obrazy; wymaga potwierdzonego maila', async () => {
      const big = await upload(author, Buffer.alloc(5 * 1024 * 1024 + 1, 1));
      expect(big.status).toBe(413);
      expect(big.body.code).toBe('PHOTO_TOO_LARGE');

      const text = await upload(author, Buffer.from('to nie jest obrazek'), 'x.jpg');
      expect(text.status).toBe(400);
      expect(text.body.code).toBe('PHOTO_INVALID');

      const unverified = await t.login('bezmaila', { verified: false });
      expect((await upload(unverified, await jpegWithGps())).status).toBe(403);
    });
  });
});
