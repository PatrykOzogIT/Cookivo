import sharp from 'sharp';
import { ReceiptExtractor, type ReceiptReading } from '../src/receipt-import/receipt-extractor.js';
import { createTestApp } from './support/app.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const item = (over: Partial<ReceiptReading['items'][number]>): ReceiptReading['items'][number] => ({
  text: '',
  name: '',
  isFood: true,
  quantity: null,
  quantityUnit: null,
  packageAmount: null,
  packageUnit: null,
  unitPrice: null,
  totalPrice: null,
  uncertain: false,
  ...over,
});

/** Odpowiedź "modelu" - testy nigdy nie wołają prawdziwego API */
const READING: ReceiptReading = {
  isReceipt: true,
  store: 'Biedronka',
  purchasedOn: '2026-10-18',
  currency: 'PLN',
  items: [
    item({
      text: 'MLEKO UHT 3,2% 1L 2 x 4,29',
      name: 'mleko 3,2%',
      quantity: 2,
      quantityUnit: 'PIECE',
      packageAmount: 1,
      packageUnit: 'l',
      unitPrice: 4.29,
      totalPrice: 8.58,
    }),
    item({
      text: 'JAJA M 10SZT 12,99',
      name: 'jajko',
      packageAmount: 10,
      packageUnit: 'PIECE',
      totalPrice: 12.99,
    }),
    item({
      text: 'BANANY LUZ 1,25 kg x 5,99',
      name: 'banan',
      quantity: 1.25,
      quantityUnit: 'kg',
      unitPrice: 5.99,
      totalPrice: 7.49,
    }),
    item({
      text: 'RYZ BIALY 500G 4,99',
      name: 'ryż biały',
      packageAmount: 500,
      packageUnit: 'g',
      totalPrice: 4.99,
    }),
    item({ text: 'PLYN NACZ 7,99', name: 'płyn do naczyń', isFood: false, totalPrice: 7.99 }),
    item({ text: 'SMOCZE JAJO 99,99', name: 'smocze jajo', totalPrice: 99.99 }),
  ],
  warnings: [],
};

describe('Import paragonu ze zdjęć (e2e)', () => {
  let t: TestApp;
  let extractor: ReceiptExtractor;
  let me: string;
  let photo: Buffer;
  let calls = 0;

  beforeAll(async () => {
    t = await createTestApp();
    extractor = t.app.get(ReceiptExtractor);
    photo = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#fff' } })
      .jpeg()
      .toBuffer();
  });

  beforeEach(async () => {
    await t.prisma.user.deleteMany();
    await t.prisma.household.deleteMany();
    me = await t.login('zakupowicz');
    calls = 0;
    extractor.enabled = true;
    extractor.extract = async () => {
      calls++;
      return { reading: structuredClone(READING), inputTokens: 1200, outputTokens: 600 };
    };
  });

  afterAll(async () => {
    await t.app.close();
  });

  const analyze = (token: string, count = 1) => {
    let req = t.api().post('/api/receipt-import').set(bearer(token)).field('lang', 'pl');
    for (let i = 0; i < count; i++) req = req.attach('photos', photo, `p${i}.jpg`);
    return req;
  };
  const commit = (token: string, id: string, body: object) =>
    t.api().post(`/api/receipt-import/${id}/commit`).set(bearer(token)).send(body);

  interface Line {
    status: string;
    ingredient: { id: string; namePl: string } | null;
    suggestions: { id: string }[];
    packages: number;
    packageAmount: number | null;
    packageUnitCode: string | null;
    priceCents: number | null;
    lineTotalCents: number | null;
    warnings: string[];
  }
  /** Linie szkicu w kształcie do zatwierdzenia (bez niedopasowanych) */
  const toCommit = (lines: Line[], over: object = {}) =>
    lines
      .filter((l) => l.ingredient && l.packageUnitCode)
      .map((l) => ({
        ingredientId: l.ingredient!.id,
        toPantry: true,
        toPrices: true,
        packages: l.packages,
        packageAmount: l.packageAmount,
        packageUnitCode: l.packageUnitCode,
        price: l.priceCents! / 100,
        ...over,
      }));

  it('bez klucza API funkcja jest wyłączona', async () => {
    extractor.enabled = false;
    const status = await t.api().get('/api/receipt-import/status').set(bearer(me)).expect(200);
    expect(status.body).toMatchObject({ enabled: false });
    expect((await analyze(me).expect(503)).body.code).toBe('IMPORT_DISABLED');
    expect(calls).toBe(0);
  });

  it('szkic: tylko żywność, przeliczone ceny, dopasowanie do bazy; nic nie zapisuje', async () => {
    const d = (await analyze(me, 2).expect(200)).body;
    expect(d).toMatchObject({
      store: 'Biedronka',
      purchasedOn: '2026-10-18',
      currency: 'PLN',
      suggestedListId: null,
      skipped: 1,
      totalCents: 858 + 1299 + 749 + 499 + 9999,
    });
    const [milk, eggs, banana, rice, dragon] = d.lines as Line[];
    expect(d.lines).toHaveLength(5);
    expect(milk).toMatchObject({
      status: 'MATCHED',
      ingredient: { namePl: 'Mleko 3,2%' },
      packages: 2,
      packageAmount: 1,
      packageUnitCode: 'l',
      priceCents: 429,
      lineTotalCents: 858,
    });
    expect(eggs).toMatchObject({
      packages: 1,
      packageAmount: 10,
      packageUnitCode: 'PIECE',
      priceCents: 1299,
    });
    expect(banana).toMatchObject({
      packages: 1.25,
      packageAmount: 1,
      packageUnitCode: 'kg',
      priceCents: 599,
    });
    expect(rice).toMatchObject({ ingredient: { namePl: 'Ryż biały' }, packageAmount: 500, priceCents: 499 });
    expect(dragon).toMatchObject({ status: 'NOT_FOUND', ingredient: null, warnings: ['NO_PACKAGE_SIZE'] });

    expect(await t.prisma.pantryItem.count()).toBe(0);
    expect(await t.prisma.priceList.count()).toBe(0);
    const row = await t.prisma.aiImport.findFirstOrThrow({ where: { id: d.importId } });
    expect(row).toMatchObject({ kind: 'RECEIPT', photos: 2, success: true, committedAt: null });
  });

  it('zatwierdzenie z nowym cennikiem: lodówka rośnie, ceny i historia; ponowne - bez duplikatów', async () => {
    const milkId = (await t.prisma.ingredient.findFirstOrThrow({ where: { namePl: 'Mleko 3,2%' } })).id;
    // W lodówce są już 2 l mleka
    await t
      .api()
      .post('/api/pantry')
      .set(bearer(me))
      .send({ ingredientId: milkId, amount: 2, unitCode: 'l' })
      .expect(201);
    const d = (await analyze(me).expect(200)).body;
    const body = {
      toPantry: true,
      toPrices: true,
      newList: { name: 'Biedronka', currency: 'PLN' },
      store: d.store,
      purchasedOn: d.purchasedOn,
      currency: 'PLN',
      lines: toCommit(d.lines),
    };
    const res = (await commit(me, d.importId, body).expect(200)).body;
    expect(res).toMatchObject({ pantry: 4, prices: 4, list: { name: 'Biedronka', created: true } });

    const pantry = (await t.api().get('/api/pantry').set(bearer(me)).expect(200)).body.items as {
      ingredient: { namePl: string };
      amount: number;
      unitCode: string;
    }[];
    const by = (name: string) => pantry.find((p) => p.ingredient.namePl === name);
    expect(by('Mleko 3,2%')).toMatchObject({ amount: 4, unitCode: 'l' }); // 2 l + 2 × 1 l
    expect(by('Jajko')).toMatchObject({ amount: 10, unitCode: 'PIECE' });
    expect(by('Banan')).toMatchObject({ amount: 1.25, unitCode: 'kg' });

    const lists = (await t.api().get('/api/prices').set(bearer(me)).expect(200)).body.lists;
    expect(lists).toEqual([expect.objectContaining({ name: 'Biedronka', isDefault: true, entries: 4 })]);
    const entries = (await t.api().get(`/api/prices/${lists[0].id}/entries`).set(bearer(me)).expect(200)).body
      .entries as {
      ingredient: { namePl: string };
      priceCents: number;
      unitPrice: { cents: number; per: string };
    }[];
    // Ryż 500 g za 4,99 → 9,98 zł za kg
    expect(entries.find((e) => e.ingredient.namePl === 'Ryż biały')).toMatchObject({
      priceCents: 499,
      unitPrice: { cents: 998, per: 'kg' },
    });
    const history = await t.prisma.priceObservation.findMany();
    expect(history).toHaveLength(4);
    expect(history[0]).toMatchObject({
      source: 'RECEIPT',
      storeName: 'Biedronka',
      currency: 'PLN',
      importId: d.importId,
    });

    // Drugie kliknięcie: ten sam wynik, nic nie rośnie
    expect((await commit(me, d.importId, body).expect(200)).body).toEqual(res);
    expect(await t.prisma.priceList.count()).toBe(1);
    expect(await t.prisma.priceObservation.count()).toBe(4);
    const again = (await t.api().get('/api/pantry').set(bearer(me)).expect(200)).body.items;
    expect(
      again.find((p: { ingredient: { namePl: string } }) => p.ingredient.namePl === 'Mleko 3,2%'),
    ).toMatchObject({
      amount: 4,
    });

    // Usunięcie cennika usuwa też jego historię cen (polityka prywatności)
    await t.api().delete(`/api/prices/${lists[0].id}`).set(bearer(me)).expect(200);
    expect(await t.prisma.priceObservation.count()).toBe(0);
  });

  it('cel dla każdej pozycji, istniejący cennik wg sklepu, walidacja i ponowienie po błędzie', async () => {
    await t.api().post('/api/prices').set(bearer(me)).send({ name: 'Dom' }).expect(201);
    await t.api().post('/api/prices').set(bearer(me)).send({ name: 'Biedronka' }).expect(201);
    const lists = (await t.api().get('/api/prices').set(bearer(me)).expect(200)).body.lists;
    const biedronka = lists.find((l: { name: string }) => l.name === 'Biedronka');
    const d = (await analyze(me).expect(200)).body;
    expect(d.suggestedListId).toBe(biedronka.id);

    const lines = toCommit(d.lines);
    const base = {
      toPantry: true,
      toPrices: true,
      currency: 'PLN',
      store: 'Biedronka',
      listId: biedronka.id,
    };
    // Nic nie wybrano / cena brakująca / obca waluta
    expect(
      (await commit(me, d.importId, { ...base, toPantry: false, toPrices: false, lines }).expect(400)).body
        .code,
    ).toBe('RECEIPT_NOTHING_SELECTED');
    expect(
      (await commit(me, d.importId, { ...base, lines: [{ ...lines[0], price: null }] }).expect(400)).body
        .code,
    ).toBe('PRICE_INVALID');
    expect((await commit(me, d.importId, { ...base, currency: 'EUR', lines }).expect(400)).body.code).toBe(
      'CURRENCY_MISMATCH',
    );
    // Cudzy cennik → 404, a import nadal czeka (transakcja wycofana)
    const other = await t.login('sasiad');
    await t.api().post('/api/prices').set(bearer(other)).send({ name: 'Obcy' }).expect(201);
    const foreign = (await t.api().get('/api/prices').set(bearer(other)).expect(200)).body.lists[0].id;
    await commit(me, d.importId, { ...base, listId: foreign, lines }).expect(404);
    expect(await t.prisma.pantryItem.count()).toBe(0);

    // Mleko tylko do cennika, jajka tylko do lodówki
    const [milk, eggs] = lines;
    const res = (
      await commit(me, d.importId, {
        ...base,
        lines: [
          { ...milk, toPantry: false },
          { ...eggs, toPrices: false },
        ],
      }).expect(200)
    ).body;
    expect(res).toMatchObject({ pantry: 1, prices: 1, list: { id: biedronka.id, created: false } });
    expect(await t.prisma.pantryItem.count()).toBe(1);
    expect(await t.prisma.priceEntry.count({ where: { listId: biedronka.id } })).toBe(1);
  });

  it('tylko lodówka bez cennika; cudzy import, zmiana gospodarstwa i przeterminowany szkic', async () => {
    const d = (await analyze(me).expect(200)).body;
    const lines = toCommit(d.lines, { toPrices: false });
    const other = await t.login('obcy');
    await commit(other, d.importId, { toPantry: true, toPrices: false, currency: 'PLN', lines }).expect(404);
    expect(
      (
        await commit(me, d.importId, {
          toPantry: true,
          toPrices: true,
          currency: 'PLN',
          lines: toCommit(d.lines),
        }).expect(400)
      ).body.code,
    ).toBe('PRICE_LIST_REQUIRED');
    expect(
      (await commit(me, d.importId, { toPantry: true, toPrices: false, currency: 'PLN', lines }).expect(200))
        .body,
    ).toEqual({
      pantry: 4,
      prices: 0,
      list: null,
    });

    // Po analizie użytkownik założył gospodarstwo - zapis trafiłby gdzie indziej
    const d2 = (await analyze(me).expect(200)).body;
    await t.api().post('/api/household').set(bearer(me)).send({ name: 'Dom' }).expect(201);
    expect(
      (await commit(me, d2.importId, { toPantry: true, toPrices: false, currency: 'PLN', lines }).expect(409))
        .body.code,
    ).toBe('HOUSEHOLD_CHANGED');

    const d3 = (await analyze(me).expect(200)).body;
    await t.prisma.aiImport.update({
      where: { id: d3.importId },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    expect(
      (await commit(me, d3.importId, { toPantry: true, toPrices: false, currency: 'PLN', lines }).expect(410))
        .body.code,
    ).toBe('IMPORT_EXPIRED');
  });

  it('nie-paragon, błąd modelu i limit dzienny', async () => {
    extractor.extract = async () => ({
      reading: { ...READING, isReceipt: false, items: [], warnings: ['To zdjęcie kota'] },
      inputTokens: 1,
      outputTokens: 1,
    });
    const res = await analyze(me).expect(422);
    expect(res.body).toMatchObject({ code: 'RECEIPT_NOT_RECEIPT', warnings: ['To zdjęcie kota'] });
    extractor.extract = async () => {
      throw new Error('timeout');
    };
    expect((await analyze(me).expect(502)).body.code).toBe('IMPORT_FAILED');
    await analyze(me, 5).expect(400);
    for (let i = 0; i < 3; i++) await analyze(me).expect(502);
    expect((await analyze(me).expect(429)).body.code).toBe('IMPORT_LIMIT');
    // Limit paragonów nie zjada limitu przepisów
    const recipe = await t.api().get('/api/recipe-import/status').set(bearer(me)).expect(200);
    expect(recipe.body.remaining).toBe(5);
  });
});
