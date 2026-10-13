import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Na hostingu aplikacja jest podpięta pod /api (Passenger). Gdyby serwer obciął ten przedrostek,
  // przywracamy go - w produkcji cały ruch do Node to i tak wyłącznie /api/*.
  if (process.env['NODE_ENV'] === 'production') {
    app.use((req: { url: string }, _res: unknown, next: () => void) => {
      if (!req.url.startsWith('/api')) req.url = '/api' + (req.url.startsWith('/') ? '' : '/') + req.url;
      next();
    });
  }
  configureApp(app);
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    const doc = new DocumentBuilder().setTitle('Cookivo API').setVersion('0.1').addBearerAuth().build();
    SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, doc));
  }

  await app.listen(config.get('PORT', { infer: true }));
}

await bootstrap();
