import sharp from 'sharp';
import { ReceiptExtractor, type ReceiptReading } from '../src/receipt-import/receipt-extractor.js';
import { createTestApp } from './support/app.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Paragon z jednym mlekiem 1 l w podanej cenie i sklepie - "model" podmieniony */
const reading = (store: string, price: number): ReceiptReading => ({
  isReceipt: true,
  store,
  purchasedOn: new Date().toISOString().slice(0, 10),
  currency: 'PLN',
  items: [
    {
      text: 'MlekoŚw3,2 1l',
      productText: 'MlekoŚw3,2 1l',
      name: 'mleko 3,2%',
      isFood: true,
      quantity: 1,
      quantityUnit: 'PIECE',
      packageAmount: 1,
      packageUnit: 'l',
      unitPrice: price,
      totalPrice: price,
      uncertain: false,
      catalogName: 'Mleko 3,2%',
      catalogMatch: 'SAME',
    },
  ],
  warnings: [],
});

describe('Ceny ogólne z paragonów (e2e)', () => {
  let t: TestApp;
  let extractor: ReceiptExtractor;
  let photo: Buffer;
  let milk: string;

  beforeAll(async () => {
    t = await createTestApp();
    extractor = t.app.get(ReceiptExtractor);
    extractor.enabled = true;
    photo = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#fff' } })
      .jpeg()
      .toBuffer();
    milk = (await t.prisma.ingredient.findFirstOrThrow({ where: { namePl: 'Mleko 3,2%' } })).id;
  });

  beforeEach(async () => {
    await t.prisma.user.deleteMany();
    await t.prisma.household.deleteMany();
  });

  afterAll(async () => {
    await t.app.close();
  });

  /** Użytkownik zatwierdza paragon: cena trafia do jego nowego cennika i do historii */
  const buy = async (name: string, store: string, price: number) => {
    const token = await t.login(name);
    extractor.extract = async () => ({ reading: reading(store, price), inputTokens: 1, outputTokens: 1 });
    const d = (
      await t
        .api()
        .post('/api/receipt-import')
        .set(bearer(token))
        .attach('photos', photo, 'p.jpg')
        .expect(200)
    ).body;
    await t
      .api()
      .post(`/api/receipt-import/${d.importId}/commit`)
      .set(bearer(token))
      .send({
        toPantry: false,
        toPrices: true,
        newList: { name: store, currency: 'PLN' },
        store,
        currency: 'PLN',
        lines: [
          {
            key: 0,
            ingredientId: milk,
            toPantry: false,
            toPrices: true,
            packages: 1,
            packageAmount: 1,
            packageUnitCode: 'l',
            price,
          },
        ],
      })
      .expect(200);
    return token;
  };

  it('mediana bez skrajności, najpierw sieć cennika; koszty bez cennika i z brakami w cenniku', async () => {
    await buy('kupiec1', 'Biedronka', 3.29);
    await buy('kupiec2', 'Biedronka', 3.39);
    await buy('kupiec3', 'Biedronka', 32.9); // pomyłka odczytu - odpada
    await buy('kupiec4', 'Lidl', 3.49);

    // Bez cennika: wszystkie sieci (3,29 / 3,39 / 3,49 → 3,39 za litr), 2 l mleka na liście
    const me = await t.login('bezcennika');
    await t
      .api()
      .post('/api/shopping/items')
      .set(bearer(me))
      .send({ ingredientId: milk, amount: 2, unitCode: 'l' })
      .expect(201);
    let list = (await t.api().get('/api/shopping').set(bearer(me)).expect(200)).body;
    expect(list.cost).toMatchObject({ listName: null, globalPriced: 1, cents: 678, missing: 0 });
    expect(list.items[0]).toMatchObject({ costCents: 678, costGlobal: true });

    // Cennik "Biedronka" bez mleka: braki z cen tej sieci (3,29 / 3,39 → 3,34)
    await t.api().post('/api/prices').set(bearer(me)).send({ name: 'Biedronka' }).expect(201);
    list = (await t.api().get('/api/shopping').set(bearer(me)).expect(200)).body;
    expect(list.cost).toMatchObject({ listName: 'Biedronka', globalPriced: 1, cents: 668 });

    // Podpowiedź przy dodawaniu ceny: 1 l w walucie cennika
    const lists = (await t.api().get('/api/prices').set(bearer(me)).expect(200)).body.lists;
    const id = lists[0].id;
    const hint = (await t.api().get(`/api/prices/${id}/global/${milk}`).set(bearer(me)).expect(200)).body;
    expect(hint.suggestion).toEqual({
      packageAmount: 1,
      packageUnitCode: 'l',
      priceCents: 334,
      sameStore: true,
    });
    const egg = (await t.prisma.ingredient.findFirstOrThrow({ where: { namePl: 'Jajko', source: 'USDA' } }))
      .id;
    expect(
      (await t.api().get(`/api/prices/${id}/global/${egg}`).set(bearer(me)).expect(200)).body.suggestion,
    ).toBeNull();

    // Własna cena ma pierwszeństwo; wpis ręczny trafia do historii, ale nie do cen ogólnych
    await t
      .api()
      .put(`/api/prices/${id}/entries`)
      .set(bearer(me))
      .send({ ingredientId: milk, packageAmount: 1, packageUnitCode: 'l', price: 2.99 })
      .expect(200);
    list = (await t.api().get('/api/shopping').set(bearer(me)).expect(200)).body;
    expect(list.cost).toMatchObject({ globalPriced: 0, cents: 598 });
    expect(await t.prisma.priceObservation.count({ where: { source: 'MANUAL' } })).toBe(1);
    expect(
      (await t.api().get(`/api/prices/${id}/global/${milk}`).set(bearer(me)).expect(200)).body.suggestion
        .priceCents,
    ).toBe(334);

    // Świeża własna cena - bez podpowiedzi; po 100 dniach - "Zaktualizuj" z ceną tego opakowania
    let entries = (await t.api().get(`/api/prices/${id}/entries`).set(bearer(me)).expect(200)).body.entries;
    expect(entries[0]).toMatchObject({
      stale: false,
      global: { unitPrice: { cents: 334, per: 'l' }, sameStore: true },
    });
    await t.prisma
      .$executeRaw`UPDATE price_entries SET updated_at = now() - interval '100 days' WHERE ingredient_id = ${milk}::uuid`;
    entries = (await t.api().get(`/api/prices/${id}/entries`).set(bearer(me)).expect(200)).body.entries;
    expect(entries[0]).toMatchObject({ stale: true, suggestedPriceCents: 334 });
  });

  it('ceny zablokowanych kont i starsze niż 60 dni się nie liczą', async () => {
    await buy('stary', 'Biedronka', 3.0);
    await t.prisma.priceObservation.updateMany({
      data: { purchasedOn: new Date(Date.now() - 61 * 86_400_000) },
    });
    await buy('zablokowany', 'Biedronka', 4.0);
    await t.prisma.user.updateMany({ where: { username: 'zablokowany' }, data: { blockedAt: new Date() } });
    const me = await t.login('sprawdzam');
    await t.api().post('/api/prices').set(bearer(me)).send({ name: 'Dom' }).expect(201);
    const id = (await t.api().get('/api/prices').set(bearer(me)).expect(200)).body.lists[0].id;
    expect(
      (await t.api().get(`/api/prices/${id}/global/${milk}`).set(bearer(me)).expect(200)).body.suggestion,
    ).toBeNull();
  });
});
