import { execSync } from 'node:child_process';
import { Client } from 'pg';

/**
 * Testy e2e działają na osobnej bazie (domyślnie `cookivo_test`) w tym samym serwerze Postgres.
 * Przed uruchomieniem tworzymy ją, jeśli trzeba, i wgrywamy migracje.
 */
export default async function setup() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Brak DATABASE_URL dla testów e2e');
  const url = new URL(databaseUrl);
  const dbName = url.pathname.slice(1);

  const admin = new Client({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: 'postgres',
  });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
  // Słowniki i składniki startowe (idempotentnie)
  execSync('npx tsx prisma/seed/run-seed.ts', { stdio: 'inherit', env: process.env });
}
