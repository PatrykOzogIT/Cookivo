/**
 * Tworzy konto SUPER_ADMIN (albo podnosi rolę istniejącego konta).
 * Super admina nie da się założyć przez API - tylko z serwera tą komendą.
 *
 *   npm run create-super-admin -- --username szef --email szef@example.com
 *
 * Hasło: ze zmiennej SUPER_ADMIN_PASSWORD albo generowane i wypisywane jeden raz.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PRIVACY_POLICY_VERSION, TERMS_VERSION } from '../src/legal/legal.js';
import { checkUsername, normalizeUsername } from '../src/auth/username-policy.js';

const { values } = parseArgs({
  options: { username: { type: 'string' }, email: { type: 'string' } },
});

if (!values.username || !values.email) {
  console.error('Użycie: npm run create-super-admin -- --username <nazwa> --email <mail>');
  process.exit(1);
}

const username = values.username.trim();
const email = values.email.trim().toLowerCase();
const problem = checkUsername(username);
// Zastrzeżone nazwy (np. "admin") są dozwolone tylko dla super admina.
if (problem && problem !== 'USERNAME_RESERVED') {
  console.error(`Nieprawidłowa nazwa użytkownika: ${problem}`);
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

try {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { role: 'SUPER_ADMIN' } });
    console.log(`Konto ${existing.username} ma teraz rolę SUPER_ADMIN.`);
  } else {
    const generated = !process.env.SUPER_ADMIN_PASSWORD;
    const password = process.env.SUPER_ADMIN_PASSWORD ?? randomBytes(18).toString('base64url');
    await prisma.user.create({
      data: {
        username,
        usernameNormalized: normalizeUsername(username),
        email,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role: 'SUPER_ADMIN',
        emailVerifiedAt: new Date(),
        consents: {
          create: [
            { type: 'TERMS', version: TERMS_VERSION },
            { type: 'PRIVACY_POLICY', version: PRIVACY_POLICY_VERSION },
          ],
        },
      },
    });
    console.log(`Utworzono super admina ${username} <${email}>.`);
    if (generated) console.log(`Hasło (zapisz je teraz, nie zostanie pokazane ponownie): ${password}`);
  }
} finally {
  await prisma.$disconnect();
}
