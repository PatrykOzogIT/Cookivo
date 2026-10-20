import { Injectable } from '@nestjs/common';
import type { OwnerScope } from '../common/owner-scope.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { pickDefault, type DefaultAlias } from './receipt-aliases.js';

export interface AliasHit {
  /** Powiązanie osoby albo jej domowników (ma pierwszeństwo) */
  mine: string | null;
  /** Domyślne dla wszystkich (większość głosów) */
  community: DefaultAlias | null;
}

/**
 * Powiązania "tekst z paragonu → składnik": własne (osoba + gospodarstwo) i domyślne z głosów
 * wszystkich (bez zablokowanych kont, tylko zatwierdzone składniki). Najpierw ta sama sieć sklepów,
 * potem dowolna.
 */
@Injectable()
export class ReceiptAliasService {
  constructor(private readonly prisma: PrismaService) {}

  async lookup(
    userId: string,
    scope: OwnerScope,
    store: string,
    keys: string[],
  ): Promise<Map<string, AliasHit>> {
    const result = new Map<string, AliasHit>();
    const unique = [...new Set(keys.filter(Boolean))];
    if (!unique.length) return result;

    const mates = scope.householdId
      ? (
          await this.prisma.householdMember.findMany({
            where: { householdId: scope.householdId },
            select: { userId: true },
          })
        ).map((m) => m.userId)
      : [userId];
    const own = await this.prisma.receiptAliasVote.findMany({
      where: {
        userId: { in: mates },
        textKey: { in: unique },
        ingredient: { OR: [{ status: 'APPROVED' }, { createdById: userId }] },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const community = await this.prisma.$queryRaw<
      { text_key: string; store_key: string; ingredient_id: string; votes: number }[]
    >(Prisma.sql`
      SELECT v.text_key, v.store_key, v.ingredient_id, count(*)::int AS votes
      FROM receipt_alias_votes v
      JOIN users u ON u.id = v.user_id
      JOIN ingredients i ON i.id = v.ingredient_id
      WHERE v.text_key = ANY(${unique}::text[])
        AND i.status = 'APPROVED'
        AND (u.blocked_at IS NULL OR (u.blocked_until IS NOT NULL AND u.blocked_until <= now()))
      GROUP BY v.text_key, v.store_key, v.ingredient_id`);

    for (const key of unique) {
      // Własne: ta sama sieć, moje przed domownikami; potem inne sieci
      const mine = own
        .filter((v) => v.textKey === key)
        .sort(
          (a, b) =>
            Number(b.storeKey === store) - Number(a.storeKey === store) ||
            Number(b.userId === userId) - Number(a.userId === userId),
        )[0];
      const rows = community.filter((r) => r.text_key === key);
      const sameStore = rows.filter((r) => r.store_key === store);
      const counts = (sameStore.length ? sameStore : rows).map((r) => ({
        ingredientId: r.ingredient_id,
        votes: r.votes,
      }));
      result.set(key, { mine: mine?.ingredientId ?? null, community: pickDefault(counts) });
    }
    return result;
  }

  /** Głosy osoby (jeden na tekst i sieć - zmiana zdania nadpisuje) */
  async vote(
    userId: string,
    store: string,
    entries: { textKey: string; ingredientId: string }[],
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const seen = new Set<string>();
    for (const e of entries) {
      if (!e.textKey || seen.has(e.textKey)) continue;
      seen.add(e.textKey);
      await db.receiptAliasVote.upsert({
        where: { userId_storeKey_textKey: { userId, storeKey: store, textKey: e.textKey } },
        create: { userId, storeKey: store, textKey: e.textKey, ingredientId: e.ingredientId },
        update: { ingredientId: e.ingredientId },
      });
    }
  }
}
