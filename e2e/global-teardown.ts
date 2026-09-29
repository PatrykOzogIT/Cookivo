import { Client } from 'pg';

/**
 * Sprzątanie po testach E2E: usuwa konta testowe (domena e2e.cookivo.test)
 * i dodane przez nie składniki, żeby nie zaśmiecały bazy deweloperskiej.
 */
export default async function teardown() {
  const url = process.env['DATABASE_URL'] ?? 'postgresql://cookivo:cookivo@localhost:5433/cookivo';
  const client = new Client({ connectionString: url.replace(/\?.*$/, '') });
  await client.connect();
  try {
    await client.query(`DELETE FROM ingredients WHERE created_by_id IN
      (SELECT id FROM users WHERE email LIKE '%@e2e.cookivo.test')`);
    await client.query(`DELETE FROM users WHERE email LIKE '%@e2e.cookivo.test'`);
  } finally {
    await client.end();
  }
}
