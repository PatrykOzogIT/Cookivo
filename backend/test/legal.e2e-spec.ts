import { PRIVACY_POLICY_VERSION, TERMS_VERSION } from '../src/legal/legal.js';
import { createTestApp } from './support/app.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Dokumenty prawne i historia zgód (e2e)', () => {
  let t: TestApp;
  let me: string;

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await t.prisma.recipeIngredient.deleteMany();
    await t.prisma.recipe.deleteMany();
    await t.prisma.user.deleteMany();
    me = await t.login('ola');
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('po rejestracji bieżące wersje są zaakceptowane, historia zawiera obie zgody', async () => {
    const res = await t.api().get('/api/me/legal').set(bearer(me)).expect(200);
    expect(res.body.pending).toEqual([]);
    expect(
      res.body.consents.map((c: { type: string; version: string }) => [c.type, c.version]).sort(),
    ).toEqual([
      ['PRIVACY_POLICY', PRIVACY_POLICY_VERSION],
      ['TERMS', TERMS_VERSION],
    ]);
  });

  it('nowa wersja regulaminu czeka na akceptację, akceptacja dopisuje wpis', async () => {
    await t.prisma.consent.updateMany({ where: { type: 'TERMS' }, data: { version: '2000-01-01' } });

    const before = await t.api().get('/api/me/legal').set(bearer(me)).expect(200);
    expect(before.body.pending).toEqual([{ type: 'TERMS', version: TERMS_VERSION }]);

    const after = await t.api().post('/api/me/legal/accept').set(bearer(me)).expect(200);
    expect(after.body.pending).toEqual([]);
    expect(after.body.consents.filter((c: { type: string }) => c.type === 'TERMS')).toHaveLength(2);

    // ponowna akceptacja nic nie dopisuje
    const again = await t.api().post('/api/me/legal/accept').set(bearer(me)).expect(200);
    expect(again.body.consents).toHaveLength(after.body.consents.length);
  });

  it('wymaga logowania', async () => {
    await t.api().get('/api/me/legal').expect(401);
  });

  it('logowanie usuwa sesje wygasłe ponad 30 dni temu', async () => {
    const user = await t.prisma.user.findFirstOrThrow({ where: { username: 'ola' } });
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await t.prisma.session.create({
      data: { userId: user.id, tokenHash: 'stara-sesja', expiresAt: old },
    });
    await t
      .api()
      .post('/api/auth/login')
      .send({ login: 'ola', password: 'Zielony-Kalafior-Tańczy-42' })
      .expect(200);
    // sprzątanie działa w tle
    await new Promise((r) => setTimeout(r, 200));
    expect(await t.prisma.session.findUnique({ where: { tokenHash: 'stara-sesja' } })).toBeNull();
  });
});
