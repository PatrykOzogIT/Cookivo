import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { storeKey } from '../receipt-import/receipt-aliases.js';
import { GLOBAL_WINDOW_DAYS, globalPrice, type GlobalPrice, type Observation } from './global-prices.js';

/**
 * Ceny ogólne z paragonów wszystkich użytkowników (mediana z ostatnich 60 dni, osobno dla waluty).
 * Tylko odczyty z paragonów (ceny wpisane ręcznie albo przyjęte z podpowiedzi się nie liczą),
 * bez zablokowanych kont. Nie zdradzamy, kto i kiedy kupił - na zewnątrz idzie tylko cena.
 */
@Injectable()
export class GlobalPricesService {
  constructor(private readonly prisma: PrismaService) {}

  /** `store` = nazwa sklepu albo cennika (np. "Biedronka"); pusta = wszystkie sieci */
  async forIngredients(
    ingredientIds: string[],
    currency: string,
    store: string | null,
  ): Promise<Map<string, GlobalPrice>> {
    const ids = [...new Set(ingredientIds)];
    const result = new Map<string, GlobalPrice>();
    if (!ids.length) return result;
    const rows = await this.prisma.$queryRaw<
      {
        ingredient_id: string;
        store_name: string | null;
        price_cents: number;
        package_grams: number;
        bought_on: Date;
      }[]
    >(Prisma.sql`
      SELECT o.ingredient_id, o.store_name, o.price_cents, o.package_grams,
             coalesce(o.purchased_on, o.created_at::date) AS bought_on
      FROM price_observations o
      JOIN ai_imports a ON a.id = o.import_id
      JOIN users u ON u.id = a.user_id
      WHERE o.source = 'RECEIPT'
        AND o.currency = ${currency}
        AND o.package_grams > 0
        AND o.ingredient_id = ANY(${ids}::uuid[])
        AND coalesce(o.purchased_on, o.created_at::date) >= current_date - ${GLOBAL_WINDOW_DAYS}::int
        AND (u.blocked_at IS NULL OR (u.blocked_until IS NOT NULL AND u.blocked_until <= now()))`);

    const byIngredient = new Map<string, Observation[]>();
    for (const r of rows) {
      const list = byIngredient.get(r.ingredient_id) ?? [];
      list.push({
        ingredientId: r.ingredient_id,
        storeKey: storeKey(r.store_name),
        centsPerGram: r.price_cents / r.package_grams,
        on: new Date(r.bought_on),
      });
      byIngredient.set(r.ingredient_id, list);
    }
    const chain = storeKey(store);
    for (const [id, observations] of byIngredient) {
      const price = globalPrice(observations, chain);
      if (price) result.set(id, price);
    }
    return result;
  }
}
