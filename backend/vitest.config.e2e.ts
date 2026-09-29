import { defineConfig } from 'vitest/config';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://cookivo:cookivo@localhost:5433/cookivo_test?schema=public';
// Potrzebne też w globalSetup (migracje), który nie dostaje `test.env`.
process.env.DATABASE_URL = TEST_DATABASE_URL;

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Testy współdzielą bazę, więc uruchamiamy pliki po kolei.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      JWT_ACCESS_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e-secret',
      APP_URL: 'http://localhost:4200',
      HIBP_ENABLED: 'false',
    },
  },
});
