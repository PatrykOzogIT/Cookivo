import { Client } from 'pg';

/**
 * Sprzątanie po testach E2E: usuwa konta testowe (domena e2e.cookivo.test)
 * razem z ich przepisami i składnikami, żeby nie zaśmiecały bazy deweloperskiej.
 */
export default async function teardown() {
  const url = process.env['DATABASE_URL'] ?? 'postgresql://cookivo:cookivo@localhost:5433/cookivo';
  const client = new Client({ connectionString: url.replace(/\?.*$/, '') });
  await client.connect();
  const testUsers = `SELECT id FROM users WHERE email LIKE '%@e2e.cookivo.test'`;
  try {
    await client.query(`DELETE FROM recipe_ingredients WHERE recipe_id IN
      (SELECT id FROM recipes WHERE author_id IN (${testUsers}))`);
    await client.query(`DELETE FROM recipes WHERE author_id IN (${testUsers})`);
    await client.query(`DELETE FROM ingredients WHERE created_by_id IN (${testUsers})`);
    await client.query(`DELETE FROM users WHERE email LIKE '%@e2e.cookivo.test'`);
  } finally {
    await client.end();
  }
}
