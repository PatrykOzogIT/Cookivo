import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { MailService } from '../src/mail/mail.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

interface SentMail {
  to: string;
  kind: string;
  url?: string;
}

const PASSWORD = 'Zielony-Kalafior-Tańczy-42';
const NEW_PASSWORD = 'Pomarańczowy-Bakłażan-Śpiewa-7';

describe('Auth (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const mails: SentMail[] = [];

  const api = () => request(app.getHttpServer());
  const tokenFrom = (mail: SentMail | undefined) => new URL(mail!.url!).searchParams.get('token')!;
  const lastMail = (kind: string) => mails.filter((m) => m.kind === kind).at(-1);
  const refreshCookie = (res: request.Response) =>
    ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('cookivo_rt='));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({
        send: (to: string, kind: string, _locale: string, vars: { url?: string }) => {
          mails.push({ to, kind, url: vars.url });
          return Promise.resolve();
        },
      })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    mails.length = 0;
    // deleteMany zamiast TRUNCATE CASCADE - ten wyczyściłby też składniki z seeda
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  function register(overrides: Record<string, unknown> = {}) {
    return api()
      .post('/api/auth/register')
      .send({
        username: 'Kasia_Gotuje',
        email: 'kasia@example.com',
        password: PASSWORD,
        acceptTerms: true,
        ...overrides,
      });
  }

  async function registerAndVerify() {
    await register().expect(202);
    await api()
      .post('/api/auth/verify-email')
      .send({ token: tokenFrom(lastMail('verifyEmail')) })
      .expect(204);
  }

  describe('rejestracja', () => {
    it('tworzy konto, zapisuje zgody i wysyła mail weryfikacyjny', async () => {
      const res = await register().expect(202);
      expect(res.body).toEqual({ status: 'CHECK_EMAIL' });

      const user = await prisma.user.findUniqueOrThrow({
        where: { email: 'kasia@example.com' },
        include: { consents: true },
      });
      expect(user.username).toBe('Kasia_Gotuje');
      expect(user.usernameNormalized).toBe('kasia_gotuje');
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.emailVerifiedAt).toBeNull();
      expect(user.consents.map((c) => c.type).sort()).toEqual(['PRIVACY_POLICY', 'TERMS']);
      expect(lastMail('verifyEmail')?.to).toBe('kasia@example.com');
    });

    it('wymaga akceptacji regulaminu', async () => {
      const res = await register({ acceptTerms: false }).expect(400);
      expect(JSON.stringify(res.body)).toContain('TERMS_REQUIRED');
    });

    it('odrzuca słabe hasło i wulgarną nazwę', async () => {
      expect((await register({ password: 'password1234' }).expect(400)).body.code).toBe('PASSWORD_WEAK');
      expect((await register({ username: 'kurwiszon' }).expect(400)).body.code).toBe('USERNAME_OFFENSIVE');
    });

    it('odrzuca nieznane pola (np. próbę nadania sobie roli)', async () => {
      await register({ role: 'SUPER_ADMIN' }).expect(400);
    });

    it('zgłasza zajętą nazwę bez względu na wielkość liter', async () => {
      await register().expect(202);
      const res = await register({ username: 'KASIA_gotuje', email: 'inna@example.com' }).expect(409);
      expect(res.body.code).toBe('USERNAME_TAKEN');
    });

    it('nie zdradza, że e-mail jest zajęty - odpowiada tak samo i wysyła ostrzeżenie', async () => {
      await register().expect(202);
      const res = await register({ username: 'ktos_inny' }).expect(202);
      expect(res.body).toEqual({ status: 'CHECK_EMAIL' });
      expect(lastMail('accountExists')?.to).toBe('kasia@example.com');
      expect(await prisma.user.count()).toBe(1);
    });

    it('sprawdza dostępność nazwy', async () => {
      await register().expect(202);
      const taken = await api().get('/api/auth/username-available?username=kasia_gotuje').expect(200);
      expect(taken.body).toEqual({ available: false, reason: 'USERNAME_TAKEN' });
      const free = await api().get('/api/auth/username-available?username=nowy_kucharz').expect(200);
      expect(free.body).toEqual({ available: true });
    });
  });

  describe('logowanie i sesja', () => {
    it('loguje nazwą lub mailem, zwraca access token i ciasteczko httpOnly', async () => {
      await registerAndVerify();

      for (const login of ['kasia_gotuje', 'KASIA@example.com']) {
        const res = await api().post('/api/auth/login').send({ login, password: PASSWORD }).expect(200);
        expect(res.body.accessToken).toBeTruthy();
        expect(res.body.user).toMatchObject({ username: 'Kasia_Gotuje', role: 'USER', emailVerified: true });
        expect(res.body).not.toHaveProperty('refreshToken');
        const cookie = refreshCookie(res)!;
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('SameSite=Strict');
        expect(cookie).toContain('Path=/api/auth');
      }
    });

    it('odpowiada tym samym błędem dla złego hasła i nieistniejącego konta', async () => {
      await registerAndVerify();
      const wrong = await api()
        .post('/api/auth/login')
        .send({ login: 'kasia_gotuje', password: 'zle-haslo-123' })
        .expect(401);
      const missing = await api()
        .post('/api/auth/login')
        .send({ login: 'nikt', password: 'zle-haslo-123' })
        .expect(401);
      expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
      expect(missing.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('blokuje konto po 5 nieudanych próbach, nawet dla poprawnego hasła', async () => {
      await registerAndVerify();
      for (let i = 0; i < 5; i++) {
        await api()
          .post('/api/auth/login')
          .send({ login: 'kasia_gotuje', password: 'zle-haslo-123' })
          .expect(401);
      }
      await api().post('/api/auth/login').send({ login: 'kasia_gotuje', password: PASSWORD }).expect(401);
    });

    it('chroni /me i wpuszcza z tokenem', async () => {
      await registerAndVerify();
      await api().get('/api/auth/me').expect(401);
      const login = await api().post('/api/auth/login').send({ login: 'kasia_gotuje', password: PASSWORD });
      const me = await api()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);
      expect(me.body.email).toBe('kasia@example.com');
      expect(me.body).not.toHaveProperty('passwordHash');
    });

    it('rotuje refresh token i unieważnia sesję przy ponownym użyciu starego', async () => {
      await registerAndVerify();
      const login = await api().post('/api/auth/login').send({ login: 'kasia_gotuje', password: PASSWORD });
      const first = refreshCookie(login)!.split(';')[0];

      const refreshed = await api().post('/api/auth/refresh').set('Cookie', first).expect(200);
      const second = refreshCookie(refreshed)!.split(';')[0];
      expect(second).not.toBe(first);

      // Ktoś użył starego tokenu - cała sesja zostaje unieważniona, także nowy token.
      await api().post('/api/auth/refresh').set('Cookie', first).expect(401);
      await api().post('/api/auth/refresh').set('Cookie', second).expect(401);
    });

    it('wylogowanie unieważnia refresh token', async () => {
      await registerAndVerify();
      const login = await api().post('/api/auth/login').send({ login: 'kasia_gotuje', password: PASSWORD });
      const cookie = refreshCookie(login)!.split(';')[0];
      await api().post('/api/auth/logout').set('Cookie', cookie).expect(204);
      await api().post('/api/auth/refresh').set('Cookie', cookie).expect(401);
    });
  });

  describe('weryfikacja maila', () => {
    it('token działa tylko raz', async () => {
      await register().expect(202);
      const token = tokenFrom(lastMail('verifyEmail'));
      await api().post('/api/auth/verify-email').send({ token }).expect(204);
      const again = await api().post('/api/auth/verify-email').send({ token }).expect(400);
      expect(again.body.code).toBe('TOKEN_INVALID');
    });

    it('ponowne wysłanie unieważnia poprzedni link', async () => {
      await register().expect(202);
      const oldToken = tokenFrom(lastMail('verifyEmail'));
      await api().post('/api/auth/resend-verification').send({ email: 'kasia@example.com' }).expect(202);
      const newToken = tokenFrom(lastMail('verifyEmail'));
      await api().post('/api/auth/verify-email').send({ token: oldToken }).expect(400);
      await api().post('/api/auth/verify-email').send({ token: newToken }).expect(204);
    });
  });

  describe('reset hasła', () => {
    it('ustawia nowe hasło i wylogowuje wszystkie sesje', async () => {
      await registerAndVerify();
      const login = await api().post('/api/auth/login').send({ login: 'kasia_gotuje', password: PASSWORD });
      const cookie = refreshCookie(login)!.split(';')[0];

      await api().post('/api/auth/forgot-password').send({ email: 'kasia@example.com' }).expect(202);
      const token = tokenFrom(lastMail('resetPassword'));
      await api().post('/api/auth/reset-password').send({ token, password: NEW_PASSWORD }).expect(204);

      await api().post('/api/auth/refresh').set('Cookie', cookie).expect(401);
      await api().post('/api/auth/login').send({ login: 'kasia_gotuje', password: PASSWORD }).expect(401);
      await api().post('/api/auth/login').send({ login: 'kasia_gotuje', password: NEW_PASSWORD }).expect(200);
    });

    it('nie zdradza, czy mail istnieje', async () => {
      const res = await api()
        .post('/api/auth/forgot-password')
        .send({ email: 'nikt@example.com' })
        .expect(202);
      expect(res.body).toEqual({ status: 'CHECK_EMAIL' });
      expect(mails).toHaveLength(0);
    });
  });
});
