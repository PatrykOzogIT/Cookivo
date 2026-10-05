import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { Client } from 'pg';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://cookivo:cookivo@localhost:5433/cookivo?schema=public';

export const TEST_PASSWORD = 'Zielony-Kalafior-Tanczy-2026';

export interface TestUser {
  username: string;
  email: string;
}

export function newUser(prefix: string): TestUser {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { username: `${prefix}_${id}`.slice(0, 20), email: `${prefix}.${id}@e2e.cookivo.test` };
}

async function sql(query: string, params: unknown[]): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL.replace(/\?.*$/, '') });
  await client.connect();
  try {
    await client.query(query, params);
  } finally {
    await client.end();
  }
}

/**
 * Konto testowe przez API + bezpośrednie potwierdzenie maila (i ewentualnie rola) w bazie.
 * Scenariusz rejestracji przez UI i maila jest osobno w auth.spec.ts.
 */
export async function createUser(
  request: APIRequestContext,
  prefix: string,
  role: 'USER' | 'ADMIN' | 'SUPER_ADMIN' = 'USER',
): Promise<TestUser> {
  const user = newUser(prefix);
  const res = await request.post('/api/auth/register', {
    data: { ...user, password: TEST_PASSWORD, acceptTerms: true, locale: 'pl' },
  });
  expect(res.status()).toBe(202);
  await sql(`UPDATE users SET email_verified_at = now(), role = $2::"Role" WHERE email = $1`, [
    user.email,
    role,
  ]);
  return user;
}

export async function loginUi(page: Page, user: TestUser): Promise<void> {
  await page.goto('/auth/login');
  await page.getByLabel('Nazwa użytkownika lub e-mail').fill(user.username);
  await page.getByLabel('Hasło', { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
  await expect(page).toHaveURL('/');
}
