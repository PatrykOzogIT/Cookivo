import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { MailService } from '../../src/mail/mail.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

export interface SentMail {
  to: string;
  kind: string;
  url?: string;
}

/** Aplikacja do testów e2e z przechwytywaniem maili zamiast wysyłki. */
export async function createTestApp() {
  const mails: SentMail[] = [];
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue({
      send: (to: string, kind: string, _locale: string, vars: { url?: string }) => {
        mails.push({ to, kind, url: vars.url });
        return Promise.resolve();
      },
    })
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  const api = () => request(app.getHttpServer());

  /** Tworzy konto (opcjonalnie z rolą i potwierdzonym mailem) i zwraca access token. */
  async function login(
    username: string,
    opts: { role?: 'USER' | 'ADMIN' | 'SUPER_ADMIN'; verified?: boolean } = {},
  ): Promise<string> {
    const email = `${username.toLowerCase()}@example.com`;
    const password = 'Zielony-Kalafior-Tańczy-42';
    await api().post('/api/auth/register').send({ username, email, password, acceptTerms: true }).expect(202);
    await prisma.user.update({
      where: { email },
      data: { role: opts.role ?? 'USER', emailVerifiedAt: opts.verified === false ? null : new Date() },
    });
    const res = await api().post('/api/auth/login').send({ login: username, password }).expect(200);
    return res.body.accessToken as string;
  }

  return { app, prisma, api, mails, login };
}
