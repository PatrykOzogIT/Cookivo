import sharp from 'sharp';
import { ReceiptExtractor, type ReceiptReading } from '../src/receipt-import/receipt-extractor.js';
import { createTestApp } from './support/app.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Paragon z produktem, którego nie ma w bazie - "model" podmieniony, bez prawdziwego API */
const READING: ReceiptReading = {
  isReceipt: true,
  store: 'Biedronka',
  purchasedOn: '2026-10-18',
  currency: 'PLN',
  items: [
    {
      text: 'BuraczkiNaszSp510g C 1 x3,65',
      productText: 'BuraczkiNaszSp510g',
      name: 'buraczki tarte',
      isFood: true,
      quantity: 1,
      quantityUnit: 'PIECE',
      packageAmount: 510,
      packageUnit: 'g',
      unitPrice: 3.65,
      totalPrice: 3.65,
      uncertain: false,
      catalogName: null,
      catalogMatch: null,
    },
  ],
  warnings: [],
};

describe('Prośby o składniki (e2e)', () => {
  let t: TestApp;
  let me: string;
  let admin: string;
  let photo: Buffer;

  beforeAll(async () => {
    t = await createTestApp();
    const extractor = t.app.get(ReceiptExtractor);
    extractor.enabled = true;
    extractor.extract = async () => ({ reading: structuredClone(READING), inputTokens: 1, outputTokens: 1 });
    photo = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#fff' } })
      .jpeg()
      .toBuffer();
  });

  beforeEach(async () => {
    await t.prisma.user.deleteMany();
    t.mails.length = 0;
    me = await t.login('kupujaca');
    admin = await t.login('szefowa', { role: 'ADMIN' });
  });

  afterAll(async () => {
    await t.app.close();
  });

  const analyze = async (token: string) =>
    (
      await t
        .api()
        .post('/api/receipt-import')
        .set(bearer(token))
        .attach('photos', photo, 'p.jpg')
        .expect(200)
    ).body;
  const request = (token: string, body: object) =>
    t.api().post('/api/ingredient-requests').set(bearer(token)).send(body);

  it('zgłoszenie z paragonu: tekst i sklep z odczytu, bez duplikatów, licznik admina', async () => {
    const d = await analyze(me);
    const res = (
      await request(me, { name: 'Buraczki tarte w słoiku', importId: d.importId, key: 0 }).expect(201)
    ).body;
    expect(res).toMatchObject({
      name: 'Buraczki tarte w słoiku',
      receiptText: 'BuraczkiNaszSp510g',
      storeName: 'Biedronka',
      status: 'OPEN',
    });
    // Ten sam tekst drugi raz - ta sama prośba
    const again = (await request(me, { name: 'buraki w słoiku', importId: d.importId, key: 0 }).expect(201))
      .body;
    expect(again.id).toBe(res.id);
    // Cudzy odczyt / zły numer pozycji
    const other = await t.login('obca');
    await request(other, { name: 'Buraczki', importId: d.importId, key: 0 }).expect(404);
    await request(me, { name: 'Buraczki', importId: d.importId, key: 7 }).expect(404);
    // Bez paragonu też można (sama nazwa)
    await request(me, { name: 'Kasza jaglana prażona' }).expect(201);
    await request(me, { name: 'x' }).expect(400);

    const summary = (await t.api().get('/api/admin/summary').set(bearer(admin)).expect(200)).body;
    expect(summary).toMatchObject({ ingredientRequests: 2 });
    await t.api().get('/api/admin/ingredient-requests').set(bearer(me)).expect(403);
    const list = (await t.api().get('/api/admin/ingredient-requests').set(bearer(admin)).expect(200)).body;
    expect(list.items.map((i: { name: string; user: string }) => [i.name, i.user])).toEqual([
      ['Buraczki tarte w słoiku', 'kupujaca'],
      ['Kasza jaglana prażona', 'kupujaca'],
    ]);
  });

  it('rozpatrzenie: składnik z bazy → prośba zamknięta, powiązanie zapamiętane, mail', async () => {
    const d = await analyze(me);
    const req = (await request(me, { name: 'Buraczki tarte', importId: d.importId, key: 0 }).expect(201))
      .body;
    const beet = (await t.prisma.ingredient.findFirstOrThrow({ where: { namePl: 'Burak' } })).id;
    await t
      .api()
      .post(`/api/admin/ingredient-requests/${req.id}/resolve`)
      .set(bearer(admin))
      .send({ ingredientId: beet })
      .expect(200);
    expect((await t.prisma.ingredientRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe(
      'DONE',
    );
    expect(t.mails.filter((m) => m.kind === 'ingredientAdded')).toHaveLength(1);

    // Kolejny taki paragon dopasuje się sam (własne powiązanie zgłaszającej)
    const next = await analyze(me);
    expect(next.lines[0]).toMatchObject({ status: 'MATCHED', matchSource: 'MINE', ingredient: { id: beet } });
    // Rozpatrzonej drugi raz nie da się zamknąć
    await t
      .api()
      .post(`/api/admin/ingredient-requests/${req.id}/resolve`)
      .set(bearer(admin))
      .send({ ingredientId: beet })
      .expect(404);
  });

  it('odrzucenie i limit otwartych próśb', async () => {
    const req = (await request(me, { name: 'Płyn do naczyń' }).expect(201)).body;
    await t.api().post(`/api/admin/ingredient-requests/${req.id}/reject`).set(bearer(admin)).expect(200);
    expect(t.mails.filter((m) => m.kind === 'ingredientRequestRejected')).toHaveLength(1);
    for (let i = 0; i < 20; i++) await request(me, { name: `Produkt numer ${i}` }).expect(201);
    expect((await request(me, { name: 'Jeden za dużo' }).expect(429)).body.code).toBe('REQUEST_LIMIT');
  });
});
