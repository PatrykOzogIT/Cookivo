import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { isAbsolute, resolve } from 'node:path';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Env } from './config/env.js';

/** Wspólna konfiguracja aplikacji - używana w main.ts i w testach e2e. */
export function configureApp(app: NestExpressApplication) {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.setGlobalPrefix('api');
  app.set('trust proxy', 'loopback');
  app.use(helmet());
  app.use(cookieParser());

  // Zdjęcia przepisów (WebP). Nazwy plików to losowe UUID + rozmiar, więc można je cache'ować na zawsze.
  const uploads = config.get('UPLOADS_DIR', { infer: true });
  app.useStaticAssets(isAbsolute(uploads) ? uploads : resolve(process.cwd(), uploads), {
    prefix: '/api/media/',
    maxAge: '365d',
    immutable: true,
    index: false,
  });
  app.enableCors({ origin: config.get('APP_URL', { infer: true }), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
}
