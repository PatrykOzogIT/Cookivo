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
  /**
   * Sterownik bazy: `pg` (TCP 5432) albo `neon` (WebSocket po 443 - hosting blokuje wychodzący port 5432).
   */
  DB_DRIVER: z.enum(['pg', 'neon']).default('pg'),
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
  /**
   * Import przepisu ze zdjęć przez Claude. Bez klucza funkcja jest wyłączona (i nic nie kosztuje).
   * Limity: na osobę na dobę i dla całego serwisu na miesiąc kalendarzowy - górna granica kosztów.
   */
  ANTHROPIC_API_KEY: z.string().optional(),
  RECIPE_IMPORT_MODEL: z.string().default('claude-haiku-5-5'),
  RECIPE_IMPORT_DAILY_LIMIT: z.coerce.number().int().min(0).default(5),
  RECEIPT_IMPORT_DAILY_LIMIT: z.coerce.number().int().min(0).default(5),
  RECIPE_IMPORT_MONTHLY_LIMIT: z.coerce.number().int().min(0).default(300),
  /**
   * Paragony: lista zatwierdzonych składników w poleceniu dla AI (lepsze dopasowanie, ~3 tys. tokenów
   * więcej na odczyt). Można wyłączyć, gdy powiązania od użytkowników wystarczą.
   */
  RECEIPT_CATALOG_HINTS: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
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
