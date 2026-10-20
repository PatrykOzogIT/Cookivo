import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../common/auth.decorators.js';
import type { Env } from '../config/env.js';
import { MailService } from '../mail/mail.service.js';
import { containsProfanity } from '../moderation/profanity.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReceiptAliasService } from '../receipt-import/receipt-alias.service.js';
import type { StoredLines } from '../receipt-import/receipt-import.service.js';

/** Ile otwartych próśb może mieć jedna osoba (ochrona kolejki admina) */
export const MAX_OPEN_REQUESTS = 20;

/**
 * Prośby o dodanie składnika - np. z nierozpoznanej pozycji paragonu. Użytkownik podaje pełną nazwę,
 * tekst z paragonu i sklep bierzemy z odczytu. Admin dodaje składnik (zwykłym formularzem) i łączy
 * go z prośbą - wtedy zgłaszający dostaje głos powiązania, więc kolejny taki paragon dopasuje się sam.
 */
@Injectable()
export class IngredientRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aliases: ReceiptAliasService,
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async create(user: AuthUser, dto: { name: string; importId?: string; key?: number }) {
    if (containsProfanity(dto.name)) throw new BadRequestException({ code: 'NAME_OFFENSIVE' });
    let receipt: { text: string; textKey: string; storeKey: string; storeName: string | null } | null = null;
    if (dto.importId !== undefined && dto.key !== undefined) {
      const record = await this.prisma.aiImport.findFirst({
        where: { id: dto.importId, userId: user.id, kind: 'RECEIPT' },
      });
      const stored = record?.lines as unknown as StoredLines | null | undefined;
      const item = stored?.items.find((i) => i.key === dto.key);
      if (!stored || !item) throw new NotFoundException({ code: 'NOT_FOUND' });
      receipt = {
        text: item.text,
        textKey: item.textKey,
        storeKey: stored.storeKey,
        storeName: stored.storeName,
      };
    }

    // Ta sama prośba drugi raz - zwracamy istniejącą
    const existing = await this.prisma.ingredientRequest.findFirst({
      where: {
        userId: user.id,
        status: 'OPEN',
        OR: [
          ...(receipt ? [{ textKey: receipt.textKey, storeKey: receipt.storeKey }] : []),
          { name: { equals: dto.name, mode: 'insensitive' as const } },
        ],
      },
    });
    if (existing) return toDto(existing);
    const open = await this.prisma.ingredientRequest.count({ where: { userId: user.id, status: 'OPEN' } });
    if (open >= MAX_OPEN_REQUESTS) {
      throw new HttpException({ code: 'REQUEST_LIMIT' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const row = await this.prisma.ingredientRequest.create({
      data: {
        userId: user.id,
        name: dto.name,
        receiptText: receipt?.text ?? null,
        storeName: receipt?.storeName ?? null,
        storeKey: receipt?.storeKey ?? '',
        textKey: receipt?.textKey ?? null,
      },
    });
    return toDto(row);
  }

  /** Kolejka admina: najstarsze otwarte na górze */
  async list(status: 'OPEN' | 'DONE' | 'REJECTED') {
    const rows = await this.prisma.ingredientRequest.findMany({
      where: { status },
      include: {
        user: { select: { username: true } },
        ingredient: { select: { id: true, namePl: true, nameEn: true } },
      },
      orderBy: { createdAt: status === 'OPEN' ? 'asc' : 'desc' },
      take: 200,
    });
    return {
      items: rows.map((r) => ({
        ...toDto(r),
        user: r.user.username,
        ingredient: r.ingredient,
      })),
    };
  }

  /**
   * Dodano składnik: prośba (i inne otwarte o ten sam tekst z paragonu) zamknięta, zgłaszający
   * dostają głos powiązania i maila.
   */
  async resolve(id: string, ingredientId: string) {
    const request = await this.find(id);
    const ingredient = await this.prisma.ingredient.findUnique({ where: { id: ingredientId } });
    if (!ingredient || ingredient.status !== 'APPROVED') {
      throw new BadRequestException({ code: 'INGREDIENT_UNKNOWN' });
    }
    const same = request.textKey
      ? await this.prisma.ingredientRequest.findMany({
          where: { status: 'OPEN', textKey: request.textKey, storeKey: request.storeKey },
        })
      : [request];
    const all = same.some((r) => r.id === request.id) ? same : [request, ...same];
    await this.prisma.$transaction(async (tx) => {
      await tx.ingredientRequest.updateMany({
        where: { id: { in: all.map((r) => r.id) } },
        data: { status: 'DONE', ingredientId, resolvedAt: new Date() },
      });
      for (const r of all) {
        if (r.textKey)
          await this.aliases.vote(r.userId, r.storeKey, [{ textKey: r.textKey, ingredientId }], tx);
      }
    });
    await this.notify(
      all.map((r) => r.userId),
      'ingredientAdded',
      ingredient.namePl,
      ingredient.id,
    );
    return { resolved: all.length };
  }

  async reject(id: string) {
    const request = await this.find(id);
    await this.prisma.ingredientRequest.update({
      where: { id },
      data: { status: 'REJECTED', resolvedAt: new Date() },
    });
    await this.notify([request.userId], 'ingredientRequestRejected', request.name, null);
    return { rejected: 1 };
  }

  // ---------------------------------------------------------------------------

  private async find(id: string) {
    const request = await this.prisma.ingredientRequest.findUnique({ where: { id } });
    if (!request || request.status !== 'OPEN') throw new NotFoundException({ code: 'NOT_FOUND' });
    return request;
  }

  private async notify(
    userIds: string[],
    kind: 'ingredientAdded' | 'ingredientRequestRejected',
    title: string,
    ingredientId: string | null,
  ): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { username: true, email: true, locale: true },
    });
    const base = this.config.get('APP_URL', { infer: true });
    for (const u of users) {
      await this.mail.send(u.email, kind, u.locale, {
        username: u.username,
        title,
        url: ingredientId ? `${base}/ingredients/${ingredientId}` : undefined,
      });
    }
  }
}

function toDto(r: {
  id: string;
  name: string;
  receiptText: string | null;
  storeName: string | null;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
}) {
  return {
    id: r.id,
    name: r.name,
    receiptText: r.receiptText,
    storeName: r.storeName,
    status: r.status,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
  };
}
