import sharp from 'sharp';
import { RecipeExtractor, type Extraction } from '../src/recipe-import/recipe-extractor.js';
import { createTestApp } from './support/app.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Odpowiedź "modelu" - testy nigdy nie wołają prawdziwego API */
const EXTRACTION: Extraction = {
  isRecipe: true,
  title: 'Placki babci',
  description: 'Z zeszytu',
  servings: 4,
  prepMinutes: 10,
  cookMinutes: 20,
  ingredients: [
    { text: '2 jajka', name: 'jajko', amount: 2, unit: 'PIECE', note: null, uncertain: false },
    { text: '1 szkl. mąki', name: 'mąka pszenna', amount: 1, unit: 'GLASS', note: null, uncertain: true },
    { text: '3 szt. mąki?', name: 'mąka pszenna', amount: 3, unit: 'PIECE', note: null, uncertain: false },
    { text: 'smocze serce', name: 'smocze serce', amount: 1, unit: 'g', note: null, uncertain: false },
    { text: 'sól do smaku', name: 'sól', amount: null, unit: null, note: 'do smaku', uncertain: false },
  ],
  steps: ['Wymieszaj.', ' ', 'Usmaż.'],
  warnings: ['Druga strona lekko rozmazana'],
};

describe('Import przepisu ze zdjęć (e2e)', () => {
  let t: TestApp;
  let extractor: RecipeExtractor;
  let me: string;
  let photo: Buffer;
  let calls = 0;

  beforeAll(async () => {
    t = await createTestApp();
    extractor = t.app.get(RecipeExtractor);
    photo = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#fff' } })
      .jpeg()
      .toBuffer();
  });

  beforeEach(async () => {
    await t.prisma.recipeIngredient.deleteMany();
    await t.prisma.recipe.deleteMany();
    await t.prisma.user.deleteMany();
    me = await t.login('kucharka');
    calls = 0;
    extractor.enabled = true;
    extractor.extract = async () => {
      calls++;
      return { extraction: structuredClone(EXTRACTION), inputTokens: 1000, outputTokens: 500 };
    };
  });

  afterAll(async () => {
    await t.app.close();
  });

  const upload = (token: string, count = 1) => {
    let req = t.api().post('/api/recipe-import').set(bearer(token)).field('lang', 'pl');
    for (let i = 0; i < count; i++) req = req.attach('photos', photo, `p${i}.jpg`);
    return req;
  };

  it('bez klucza API funkcja jest wyłączona', async () => {
    extractor.enabled = false;
    const status = await t.api().get('/api/recipe-import/status').set(bearer(me)).expect(200);
    expect(status.body).toMatchObject({ enabled: false });
    const res = await upload(me).expect(503);
    expect(res.body.code).toBe('IMPORT_DISABLED');
    expect(calls).toBe(0);
  });

  it('szkic: dopasowane składniki, podpowiedzi, problemy z jednostką i uwagi', async () => {
    const res = await upload(me, 2).expect(200);
    const d = res.body;
    expect(d).toMatchObject({ title: 'Placki babci', servings: 4, prepMinutes: 10, cookMinutes: 20 });
    expect(d.steps).toEqual(['Wymieszaj.', 'Usmaż.']);
    expect(d.warnings).toEqual(['Druga strona lekko rozmazana']);

    const [egg, flour, flourPieces, dragon, salt] = d.ingredients;
    expect(egg).toMatchObject({ match: { namePl: 'Jajko' }, unitCode: 'PIECE', unitProblem: false });
    expect(flour).toMatchObject({ match: { namePl: 'Mąka pszenna' }, unitCode: 'GLASS', uncertain: true });
    // Mąka nie ma jednostki "sztuka" - jednostkę wybierze użytkownik
    expect(flourPieces).toMatchObject({
      match: { namePl: 'Mąka pszenna' },
      unitCode: null,
      unitProblem: true,
    });
    expect(dragon).toMatchObject({ match: null, name: 'smocze serce' });
    expect(salt).toMatchObject({ amount: null, note: 'do smaku' });

    const status = await t.api().get('/api/recipe-import/status').set(bearer(me)).expect(200);
    expect(status.body).toMatchObject({ enabled: true, remaining: 4, dailyLimit: 5, maxPhotos: 3 });
    const row = await t.prisma.recipeImport.findFirstOrThrow();
    expect(row).toMatchObject({ photos: 2, success: true, inputTokens: 1000, outputTokens: 500 });
  });

  it('limit dzienny na osobę', async () => {
    for (let i = 0; i < 5; i++) await upload(me).expect(200);
    const res = await upload(me).expect(429);
    expect(res.body.code).toBe('IMPORT_LIMIT');
    expect(calls).toBe(5);
  });

  it('za dużo zdjęć, brak zdjęć, nie-przepis i błąd modelu', async () => {
    await upload(me, 4).expect(400);
    await upload(me, 0).expect(400);

    extractor.extract = async () => ({
      extraction: { ...EXTRACTION, isRecipe: false, warnings: ['To zdjęcie kota'] },
      inputTokens: 1,
      outputTokens: 1,
    });
    const notRecipe = await upload(me).expect(422);
    expect(notRecipe.body).toMatchObject({ code: 'IMPORT_NOT_RECIPE', warnings: ['To zdjęcie kota'] });

    extractor.extract = async () => {
      throw new Error('API niedostępne');
    };
    const failed = await upload(me).expect(502);
    expect(failed.body.code).toBe('IMPORT_FAILED');
    // Nieudane próby też liczą się do limitu (kosztują)
    expect(await t.prisma.recipeImport.count()).toBe(2);
  });

  it('wymaga potwierdzonego adresu e-mail', async () => {
    const unverified = await t.login('nowa', { verified: false });
    await upload(unverified).expect(403);
  });
});
