import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Env } from '../config/env.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    const connectionString = config.get('DATABASE_URL', { infer: true });
    super({ adapter: createAdapter(config.get('DB_DRIVER', { infer: true }), connectionString) });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

/**
 * Lokalnie i w testach zwykły `pg` po TCP. Na hostingu wychodzący port 5432 jest zablokowany,
 * więc z Neon łączymy się przez WebSocket po 443 (wbudowany WebSocket z Node 22).
 */
function createAdapter(driver: Env['DB_DRIVER'], connectionString: string) {
  if (driver === 'neon') {
    neonConfig.webSocketConstructor = globalThis.WebSocket;
    return new PrismaNeon({ connectionString });
  }
  return new PrismaPg({ connectionString });
}
