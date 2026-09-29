import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  APP_URL: z.url().default('http://localhost:4200'),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Cookivo <no-reply@cookivo.local>'),
  HIBP_ENABLED: bool,
  /** Katalog na zdjęcia (WebP). W produkcji zamienimy na magazyn S3. */
  UPLOADS_DIR: z.string().default('uploads'),
  /** Limity żądań (ochrona przed zgadywaniem haseł). Wyłączamy tylko w testach E2E. */
  THROTTLE_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Nieprawidłowa konfiguracja środowiska:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
