import sharp from 'sharp';
import { LabelExtractor, type LabelReading } from '../src/label-import/label-extractor.js';
import { createTestApp } from './support/app.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Odpowiedź "modelu" - testy nigdy nie wołają prawdziwego API */
const READING: LabelReading = {
  isFoodLabel: true,
  printedName: 'Jogurt Bałkański Kremowy 2%',
  namePl: 'Jogurt naturalny bałkański 2%',
  nameEn: 'Balkan-style plain yogurt 2%',
  category: 'DAIRY',
  basis: 'PER_100G',
  portionAmount: null,
  kj: null,
  kcal: 61,
  protein: 4.3,
  fat: 2,
  saturatedFat: 1.3,
  carbs: 6.4,
  sugars: 6.4,
  fiber: null,
  salt: 0.13,
  ingredientsVisible: true,
  allergens: ['MILK'],
  mayContain: ['MILK', 'NUTS'],
  packageAmount: 400,
  packageUnit: 'g',
  warnings: [],
};

const dto = (namePl: string) => ({
  namePl,
  categoryCode: 'DAIRY',
  kcal: 61,
  protein: 4.3,
  fat: 2,
  carbs: 6.4,
  allergens: ['MILK'],
  units: [],
});

describe('Etykieta produktu ze zdjęcia i duble składników (e2e)', () => {
  let t: TestApp;
  let extractor: LabelExtractor;
  let me: string;
  let photo: Buffer;
  let hint: string | null = null;

  beforeAll(async () => {
    t = await createTestApp();
    extractor = t.app.get(LabelExtractor);
    photo = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#fff' } })
      .jpeg()
      .toBuffer();
  });

  beforeEach(async () => {
    await t.prisma.ingredient.deleteMany({ where: { source: { in: ['USER', 'LABEL'] } } });
    await t.prisma.user.deleteMany();
    me = await t.login('etykieta');
    hint = null;
    extractor.enabled = true;
    extractor.extract = async (_images, _lang, h) => {
      hint = h;
      return { reading: structuredClone(READING), inputTokens: 900, outputTokens: 300 };
    };
  });

  afterAll(async () => {
    await t.app.close();
  });

  const analyze = (token: string, count = 1, name?: string) => {
    let req = t.api().post('/api/label-import').set(bearer(token)).field('lang', 'pl');
    if (name) req = req.field('name', name);
    for (let i = 0; i < count; i++) req = req.attach('photos', photo, `p${i}.jpg`);
    return req;
  };

  it('odczyt: wartości na 100 g, alergeny, "może zawierać" osobno, opakowanie, licznik', async () => {
    const res = (await analyze(me, 2).expect(200)).body;
    expect(res).toMatchObject({
      namePl: 'Jogurt naturalny bałkański 2%',
      nameEn: 'Balkan-style plain yogurt 2%',
      printedName: 'Jogurt Bałkański Kremowy 2%',
      category: 'DAIRY',
      values: {
        kcal: 61,
        protein: 4.3,
        fat: 2,
        saturatedFat: 1.3,
        carbs: 6.4,
        sugars: 6.4,
        fiber: null,
        salt: 0.13,
      },
      missing: [],
      problem: null,
      allergens: ['MILK'],
      mayContain: ['NUTS'],
      packageGrams: 400,
      liquid: false,
    });
    const row = await t.prisma.aiImport.findFirstOrThrow({ where: { kind: 'LABEL' } });
    expect(row).toMatchObject({ photos: 2, success: true });
    const status = (await t.api().get('/api/label-import/status').set(bearer(me)).expect(200)).body;
    expect(status).toMatchObject({ enabled: true, dailyLimit: 10, remaining: 9, maxPhotos: 2 });
  });

  it('nazwa wpisana w formularzu ma pierwszeństwo i trafia do modelu jako podpowiedź', async () => {
    const res = (await analyze(me, 1, 'Jogurt grecki 2%').expect(200)).body;
    expect(hint).toBe('Jogurt grecki 2%');
    expect(res.namePl).toBe('Jogurt grecki 2%');
  });

  it('nieczytelne: brak nazwy i wartości zostaje pustym polem, tylko porcja bez wielkości', async () => {
    extractor.extract = async () => ({
      reading: {
        ...structuredClone(READING),
        namePl: null,
        nameEn: null,
        basis: 'PER_PORTION',
        portionAmount: null,
        warnings: ['Tabela częściowo nieczytelna.'],
      },
      inputTokens: 1,
      outputTokens: 1,
    });
    const res = (await analyze(me).expect(200)).body;
    expect(res.namePl).toBeNull();
    expect(res.similar).toEqual([]);
    expect(res.portionUnknown).toBe(true);
    expect(res.values.kcal).toBeNull();
    expect(res.missing).toEqual(['kcal', 'protein', 'fat', 'carbs']);
    expect(res.warnings).toEqual(['Tabela częściowo nieczytelna.']);
  });

  it('to nie etykieta → 422; błąd modelu → 502; limit; złe zdjęcia', async () => {
    extractor.extract = async () => ({
      reading: { ...structuredClone(READING), isFoodLabel: false, warnings: ['To zdjęcie kota.'] },
      inputTokens: 1,
      outputTokens: 1,
    });
    const not = await analyze(me).expect(422);
    expect(not.body).toMatchObject({ code: 'LABEL_NOT_LABEL', warnings: ['To zdjęcie kota.'] });
    extractor.extract = async () => {
      throw new Error('timeout');
    };
    expect((await analyze(me).expect(502)).body.code).toBe('IMPORT_FAILED');
    await analyze(me, 3).expect(400);
    await t.api().post('/api/label-import').set(bearer(me)).field('lang', 'pl').expect(400);
    // Wyczerpany limit dzienny (nieudane próby też się liczą)
    const userId = (await t.prisma.user.findFirstOrThrow({ where: { username: 'etykieta' } })).id;
    await t.prisma.aiImport.createMany({
      data: Array.from({ length: 8 }, () => ({ userId, kind: 'LABEL' as const, photos: 1 })),
    });
    expect((await analyze(me).expect(429)).body.code).toBe('IMPORT_LIMIT');
    extractor.enabled = false;
    await analyze(me).expect(503);
  });

  it('duble: podobne składniki w odczycie i w formularzu, blokada tej samej nazwy po normalizacji', async () => {
    const admin = await t.login('szef', { role: 'ADMIN' });
    await t.api().post('/api/ingredients').set(bearer(admin)).send(dto('Ćwikła domowa')).expect(201);
    // Własny oczekujący składnik innej osoby widzi tylko admin
    const other = await t.login('ktos');
    await t
      .api()
      .post('/api/ingredients')
      .set(bearer(other))
      .send(dto('Jogurt naturalny bałkański'))
      .expect(201);

    const similar = (q: string, token = me) =>
      t.api().get('/api/ingredients/similar').query({ namePl: q }).set(bearer(token)).expect(200);
    expect((await similar('ziemniak')).body.map((i: { namePl: string }) => i.namePl)).toContain('Ziemniaki');
    expect((await similar('cwikla domowa')).body).toEqual([
      expect.objectContaining({ namePl: 'Ćwikła domowa', status: 'APPROVED' }),
    ]);
    // Ogólny składnik z bazy jest podobny; cudzy oczekujący widzi tylko admin (zatwierdzone pierwsze)
    const names = (body: { namePl: string }[]) => body.map((i) => i.namePl);
    expect(names((await similar('Jogurt naturalny bałkański 2%')).body)).toEqual(['Jogurt naturalny']);
    expect(names((await similar('Jogurt naturalny bałkański 2%', admin)).body)).toEqual([
      'Jogurt naturalny',
      'Jogurt naturalny bałkański',
    ]);
    // Odczyt etykiety od razu podaje możliwe duble
    extractor.extract = async () => ({
      reading: { ...structuredClone(READING), namePl: 'Ćwikła domowa z chrzanem' },
      inputTokens: 1,
      outputTokens: 1,
    });
    expect((await analyze(me).expect(200)).body.similar).toEqual([
      expect.objectContaining({ namePl: 'Ćwikła domowa' }),
    ]);

    // Ta sama nazwa bez polskich znaków - blokada z identyfikatorem istniejącego
    const dup = await t
      .api()
      .post('/api/ingredients')
      .set(bearer(me))
      .send(dto('Cwikla  DOMOWA'))
      .expect(409);
    expect(dup.body.code).toBe('INGREDIENT_EXISTS');
    expect(dup.body.id).toBeTruthy();

    // Składnik z etykiety ma źródło "etykieta"
    const saved = (
      await t
        .api()
        .post('/api/ingredients')
        .set(bearer(me))
        .send({ ...dto('Jogurt grecki 10%'), fromLabel: true })
        .expect(201)
    ).body;
    expect(saved.source).toBe('LABEL');
  });
});
