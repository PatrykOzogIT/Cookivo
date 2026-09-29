import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { HealthController } from './health.controller.js';
import { IngredientsModule } from './ingredients/ingredients.module.js';
import { PhotosModule } from './photos/photos.module.js';
import { RecipesModule } from './recipes/recipes.module.js';
import { VerifiedEmailGuard } from './common/verified-email.guard.js';
import { JwtAuthGuard } from './common/jwt-auth.guard.js';
import { RolesGuard } from './common/roles.guard.js';
import { validateEnv, type Env } from './config/env.js';
import { MailModule } from './mail/mail.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        // Testy wykonują dziesiątki logowań z jednego IP.
        const disabled =
          config.get('NODE_ENV', { infer: true }) === 'test' ||
          !config.get('THROTTLE_ENABLED', { infer: true });
        return { throttlers: [{ ttl: 60_000, limit: 120 }], skipIf: () => disabled };
      },
    }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: { algorithm: 'HS256', issuer: 'cookivo' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'cookivo' },
      }),
    }),
    PrismaModule,
    MailModule,
    AuthModule,
    IngredientsModule,
    PhotosModule,
    RecipesModule,
  ],
  controllers: [HealthController],
  providers: [
    // Kolejność ma znaczenie: limit żądań → uwierzytelnienie → role → potwierdzony e-mail
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: VerifiedEmailGuard },
  ],
})
export class AppModule {}
