import { createTestApp } from './support/app.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const PASSWORD = 'Zielony-Kalafior-Tańczy-42';

describe('Panel admina: użytkownicy, blokady, role (e2e)', () => {
  let t: TestApp;
  let admin: string;
  let superAdmin: string;
  let user: string;

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await t.prisma.recipe.deleteMany();
    await t.prisma.user.deleteMany();
    t.mails.length = 0;
    admin = await t.login('szefowa', { role: 'ADMIN' });
    superAdmin = await t.login('wlasciciel', { role: 'SUPER_ADMIN' });
    user = await t.login('kucharz');
  });

  afterAll(async () => {
    await t.app.close();
  });

  const api = () => t.api();
  const idOf = async (username: string) =>
    (await t.prisma.user.findUniqueOrThrow({ where: { usernameNormalized: username } })).id;

  it('lista z wyszukiwaniem i filtrem, tylko dla admina', async () => {
    await api().get('/api/admin/users').set(bearer(user)).expect(403);
    const all = (await api().get('/api/admin/users').set(bearer(admin)).expect(200)).body;
    expect(all.total).toBe(3);
    const found = (await api().get('/api/admin/users?q=KUCH').set(bearer(admin)).expect(200)).body;
    expect(found.items).toHaveLength(1);
    expect(found.items[0]).toMatchObject({ username: 'kucharz', role: 'USER', block: null, recipesCount: 0 });
    const admins = (await api().get('/api/admin/users?filter=admins').set(bearer(admin)).expect(200)).body;
    expect(admins.items.map((u: { username: string }) => u.username).sort()).toEqual([
      'szefowa',
      'wlasciciel',
    ]);
  });

  it('blokada czasowa: wylogowanie, mail, komunikat przy logowaniu; odblokowanie', async () => {
    const id = await idOf('kucharz');
    // Sesja z ciasteczkiem refresh, żeby sprawdzić odświeżanie po blokadzie
    const agent = t.api();
    const loginRes = await agent
      .post('/api/auth/login')
      .send({ login: 'kucharz', password: PASSWORD })
      .expect(200);
    const cookie = loginRes.headers['set-cookie'];

    const res = await api()
      .post(`/api/admin/users/${id}/block`)
      .set(bearer(admin))
      .send({ days: 7, reason: 'Spam w komentarzach' })
      .expect(201);
    expect(new Date(res.body.block.until).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect(t.mails.map((m) => m.kind)).toContain('accountBlocked');

    // Logowanie: 403 z terminem i powodem
    const denied = await api()
      .post('/api/auth/login')
      .send({ login: 'kucharz', password: PASSWORD })
      .expect(403);
    expect(denied.body).toMatchObject({ code: 'ACCOUNT_BLOCKED', reason: 'Spam w komentarzach' });
    expect(denied.body.until).toBeTruthy();
    // Złe hasło nie zdradza blokady
    await api()
      .post('/api/auth/login')
      .send({ login: 'kucharz', password: 'zle-haslo-zle-haslo' })
      .expect(401);
    // Sesje unieważnione, a stary access token nie pozwala na zapis
    await api().post('/api/auth/refresh').set('Cookie', cookie).expect(401);
    const write = await api()
      .post('/api/reports')
      .set(bearer(user))
      .send({ targetType: 'USER', userId: await idOf('szefowa'), reason: 'SPAM' })
      .expect(403);
    expect(write.body.code).toBe('ACCOUNT_BLOCKED');

    const listed = (await api().get('/api/admin/users?filter=blocked').set(bearer(admin)).expect(200)).body;
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].block.reason).toBe('Spam w komentarzach');

    await api().delete(`/api/admin/users/${id}/block`).set(bearer(admin)).expect(200);
    await api().post('/api/auth/login').send({ login: 'kucharz', password: PASSWORD }).expect(200);
  });

  it('blokada stała i wygasła blokada czasowa', async () => {
    const id = await idOf('kucharz');
    await api()
      .post(`/api/admin/users/${id}/block`)
      .set(bearer(admin))
      .send({ reason: 'Konto spamowe' })
      .expect(201);
    const denied = await api()
      .post('/api/auth/login')
      .send({ login: 'kucharz', password: PASSWORD })
      .expect(403);
    expect(denied.body).toMatchObject({ code: 'ACCOUNT_BLOCKED', until: null });

    // Termin minął - logowanie znów działa
    await t.prisma.user.update({ where: { id }, data: { blockedUntil: new Date(Date.now() - 1000) } });
    await api().post('/api/auth/login').send({ login: 'kucharz', password: PASSWORD }).expect(200);
  });

  it('ograniczenia: nie siebie, admina blokuje tylko super admin, super admina nikt', async () => {
    const adminId = await idOf('szefowa');
    const superId = await idOf('wlasciciel');
    const block = { days: 1, reason: 'Test blokady' };
    const self = await api()
      .post(`/api/admin/users/${adminId}/block`)
      .set(bearer(admin))
      .send(block)
      .expect(403);
    expect(self.body.code).toBe('CANNOT_MODIFY_SELF');
    await t.login('drugaadmin', { role: 'ADMIN' });
    const other = await idOf('drugaadmin');
    await api().post(`/api/admin/users/${other}/block`).set(bearer(admin)).send(block).expect(403);
    await api().post(`/api/admin/users/${superId}/block`).set(bearer(admin)).send(block).expect(403);
    await api().post(`/api/admin/users/${other}/block`).set(bearer(superAdmin)).send(block).expect(201);
  });

  it('role: nadaje i odbiera tylko super admin, zmiana działa od razu', async () => {
    const id = await idOf('kucharz');
    await api().patch(`/api/admin/users/${id}/role`).set(bearer(admin)).send({ role: 'ADMIN' }).expect(403);
    await api()
      .patch(`/api/admin/users/${id}/role`)
      .set(bearer(superAdmin))
      .send({ role: 'SUPER_ADMIN' })
      .expect(400);
    await api()
      .patch(`/api/admin/users/${id}/role`)
      .set(bearer(superAdmin))
      .send({ role: 'ADMIN' })
      .expect(200);
    // Stary token (rola USER) - panel admina dostępny, bo rola sprawdzana w bazie
    await api().get('/api/admin/users').set(bearer(user)).expect(200);

    await api()
      .patch(`/api/admin/users/${id}/role`)
      .set(bearer(superAdmin))
      .send({ role: 'USER' })
      .expect(200);
    await api().get('/api/admin/users').set(bearer(user)).expect(403);
    const selfRes = await api()
      .patch(`/api/admin/users/${await idOf('wlasciciel')}/role`)
      .set(bearer(superAdmin))
      .send({ role: 'USER' })
      .expect(403);
    expect(selfRes.body.code).toBe('CANNOT_MODIFY_SELF');
  });
});
