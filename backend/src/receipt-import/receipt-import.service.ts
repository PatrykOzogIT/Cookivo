import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiUsageService } from '../ai/ai-usage.service.js';
import { matchIngredient, unitAllowed, type Candidate } from '../ai/ingredient-match.js';
import { toModelImage } from '../ai/vision.service.js';
import type { AuthUser } from '../common/auth.decorators.js';
import { ownerScope, type OwnerScope } from '../common/owner-scope.js';
import { normalizeSearch } from '../common/text.js';
import { Prisma } from '../generated/prisma/client.js';
import { IngredientsService } from '../ingredients/ingredients.service.js';
import { PantryService } from '../pantry/pantry.service.js';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { CURRENCIES } from '../prices/prices.dto.js';
import { PricesService } from '../prices/prices.service.js';
import { toDate } from '../planner/planner.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecipeCalculatorService } from '../recipes/recipe-calculator.service.js';
import { ReceiptAliasService } from './receipt-alias.service.js';
import { storeKey, textKey } from './receipt-aliases.js';
import { ReceiptExtractor, type ReceiptReading } from './receipt-extractor.js';
import type { ReceiptCommitDto } from './receipt-import.dto.js';
import { purchaseDate, receiptLine, toCents } from './receipt-math.js';

export const MAX_RECEIPT_PHOTOS = 4;
/** Paragon odczytany wcześniej niż dobę temu trzeba odczytać od nowa */
const COMMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_LINES = 100;

/** Wynik zatwierdzenia - zapisany przy imporcie i zwracany przy ponownym zatwierdzeniu */
export interface CommitResult {
  pantry: number;
  prices: number;
  list: { id: string; name: string; created: boolean } | null;
}

/** Składnik z bazy w kształcie, którego używa podgląd (wybór jednostek opakowania) */
export interface LineIngredient {
  id: string;
  namePl: string;
  nameEn: string | null;
  density: number | null;
  units: { code: string; namePl: string; nameEn: string | null; grams: number }[];
  category: { icon: string };
}

type MatchStatus = 'MATCHED' | 'CONFIRM';
type MatchSource = 'MINE' | 'COMMUNITY' | 'AI' | 'NAME';

interface Catalog {
  text: string;
  /** nazwa małymi literami → id */
  byName: Map<string, string>;
}

/** Teksty pozycji zapisane przy odczycie (ai_imports.lines) - do głosów i próśb o składniki */
export interface StoredLines {
  storeKey: string;
  storeName: string | null;
  items: { key: number; text: string; textKey: string }[];
}

const CATALOG_TTL_MS = 60 * 60 * 1000;

function lineItem(c: Candidate): LineIngredient {
  return {
    id: c.id,
    namePl: c.namePl,
    nameEn: c.nameEn,
    density: c.density,
    units: c.units,
    category: { icon: c.category.icon },
  };
}

function scopeKey(scope: OwnerScope): string {
  return scope.householdId ? `h:${scope.householdId}` : `u:${scope.userId}`;
}

/**
 * Import paragonu ze zdjęć: AI odczytuje pozycje → szkic z dopasowaniem do bazy →
 * użytkownik sprawdza i zatwierdza → jedna transakcja: lodówka, cennik (ew. nowy), historia cen.
 * Wspólny dla lodówki i cenników. Zdjęć nie przechowujemy.
 */
@Injectable()
export class ReceiptImportService {
  private readonly logger = new Logger(ReceiptImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly extractor: ReceiptExtractor,
    private readonly usage: AiUsageService,
    private readonly ingredients: IngredientsService,
    private readonly calculator: RecipeCalculatorService,
    private readonly pantry: PantryService,
    private readonly prices: PricesService,
    private readonly aliases: ReceiptAliasService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private catalogCache: { at: number; value: Catalog } | null = null;

  async status(userId: string) {
    return {
      enabled: this.extractor.enabled,
      dailyLimit: this.usage.dailyLimit('RECEIPT'),
      remaining: await this.usage.remaining(userId, 'RECEIPT'),
      maxPhotos: MAX_RECEIPT_PHOTOS,
    };
  }

  // --- 1. Analiza: zdjęcia → szkic (nic nie zapisujemy poza licznikiem) ----------------

  async analyze(user: AuthUser, files: Buffer[], lang: 'pl' | 'en') {
    if (!this.extractor.enabled) throw new ServiceUnavailableException({ code: 'IMPORT_DISABLED' });
    if (!files.length || files.length > MAX_RECEIPT_PHOTOS) {
      throw new BadRequestException({ code: 'PHOTO_INVALID' });
    }
    await this.usage.assertAvailable(user.id, 'RECEIPT');
    const images = await Promise.all(files.map(toModelImage));
    const scope = await ownerScope(this.prisma, user.id);
    const importId = await this.usage.start(user.id, 'RECEIPT', images.length, scopeKey(scope));
    const catalog = this.config.get('RECEIPT_CATALOG_HINTS', { infer: true }) ? await this.catalog() : null;

    let reading: ReceiptReading;
    try {
      const result = await this.extractor.extract(images, lang, catalog?.text ?? null);
      reading = result.reading;
      await this.usage.finish(importId, result);
    } catch (err) {
      this.logger.warn(`Odczyt paragonu nieudany: ${(err as Error).message}`);
      throw new HttpException({ code: 'IMPORT_FAILED' }, HttpStatus.BAD_GATEWAY);
    }
    if (!reading.isReceipt) {
      throw new HttpException(
        { code: 'RECEIPT_NOT_RECEIPT', warnings: reading.warnings },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return this.toDraft(importId, reading, scope, user, catalog);
  }

  /**
   * Szkic: tylko produkty spożywcze, przeliczone ceny, dopasowanie do bazy i propozycja cennika.
   * Kolejność dopasowania: własne powiązanie → pewne domyślne (głosy) → AI "ten sam" → pewna nazwa;
   * do potwierdzenia: niepewne domyślne → AI "odpowiednik" → nazwa z bazy na początku odczytu.
   */
  private async toDraft(
    importId: string,
    r: ReceiptReading,
    scope: OwnerScope,
    user: AuthUser,
    catalog: Catalog | null,
  ) {
    const unitMl = await this.calculator.unitMl();
    const food = r.items
      .filter((i) => i.isFood && (i.totalPrice === null || i.totalPrice > 0))
      .slice(0, MAX_LINES);
    const store = r.store?.trim().slice(0, 80) || null;
    const chain = storeKey(store);
    const keys = food.map((i) => textKey(i.productText || i.text));
    const aliases = await this.aliases.lookup(user.id, scope, chain, keys);

    // Składniki wskazane przez powiązania i AI - jednym zapytaniem
    const aiIds = food.map((i) =>
      i.catalogName ? (catalog?.byName.get(i.catalogName.trim().toLowerCase()) ?? null) : null,
    );
    const wanted = new Set<string>(aiIds.filter((id): id is string => !!id));
    for (const hit of aliases.values()) {
      if (hit.mine) wanted.add(hit.mine);
      if (hit.community) wanted.add(hit.community.ingredientId);
    }
    const known = await this.loadItems([...wanted]);

    const lines = await Promise.all(
      food.map(async (item, index) => {
        const numbers = receiptLine(item);
        const { match, suggestions, partial } = await matchIngredient(this.ingredients, item.name, user);
        const hit = aliases.get(keys[index]);
        const pick = (id: string | null | undefined) => (id ? (known.get(id) ?? null) : null);
        const aiPick = pick(aiIds[index]);
        const candidates: [LineIngredient | null, MatchStatus, MatchSource][] = [
          [pick(hit?.mine), 'MATCHED', 'MINE'],
          [hit?.community?.confident ? pick(hit.community.ingredientId) : null, 'MATCHED', 'COMMUNITY'],
          [item.catalogMatch === 'SAME' ? aiPick : null, 'MATCHED', 'AI'],
          [match ? lineItem(match) : null, 'MATCHED', 'NAME'],
          [pick(hit?.community?.ingredientId), 'CONFIRM', 'COMMUNITY'],
          [aiPick, 'CONFIRM', 'AI'],
          [partial ? lineItem(partial) : null, 'CONFIRM', 'NAME'],
        ];
        const [chosen, status, source] = candidates.find(([i]) => i) ?? [null, null, null];

        let { packageAmount, packageUnitCode } = numbers;
        let warnings: string[] = numbers.warnings;
        if (chosen) {
          if (packageUnitCode && !unitAllowed(packageUnitCode, chosen, unitMl)) {
            // Np. "1 l" przy składniku bez gęstości - użytkownik poda wielkość sam
            packageAmount = null;
            packageUnitCode = null;
            warnings = [...warnings, 'UNIT_NOT_ALLOWED'];
          } else if (!packageUnitCode && chosen.units.some((u) => u.code === 'PIECE')) {
            // Sztuka bez gramatury (bułka, banan) - opakowanie = 1 szt. (gramy z bazy)
            packageAmount = 1;
            packageUnitCode = 'PIECE';
            warnings = warnings.filter((w) => w !== 'NO_PACKAGE_SIZE');
          }
        }
        const others = suggestions.map(lineItem).filter((s) => s.id !== chosen?.id);
        return {
          key: index,
          text: item.text.slice(0, 120),
          name: item.name.trim().slice(0, 80),
          status: status ?? (others.length ? 'CONFIRM' : 'NOT_FOUND'),
          /** Skąd dopasowanie: własne / innych / AI / nazwa */
          matchSource: source,
          ingredient: chosen,
          suggestions: others,
          packages: numbers.packages,
          packageAmount,
          packageUnitCode,
          priceCents: numbers.priceCents,
          lineTotalCents: numbers.lineTotalCents,
          uncertain: item.uncertain,
          warnings,
        };
      }),
    );

    // Nazwy produktów do głosów i próśb o składniki (do zatwierdzenia, maks. doba)
    const stored: StoredLines = {
      storeKey: chain,
      storeName: store,
      items: food.map((item, index) => ({
        key: index,
        text: (item.productText || item.text).trim().slice(0, 120),
        textKey: keys[index],
      })),
    };
    await this.prisma.aiImport.update({
      where: { id: importId },
      data: { lines: stored as unknown as Prisma.InputJsonValue },
    });

    const currency = CURRENCIES.find((c) => c === r.currency?.trim().toUpperCase()) ?? null;
    return {
      importId,
      store,
      purchasedOn: purchaseDate(r.purchasedOn),
      /** null = nie odczytano albo nieobsługiwana waluta - użytkownik wybiera */
      currency,
      currencyRead: r.currency?.trim().slice(0, 10) || null,
      suggestedListId: await this.suggestList(scope, store),
      lines,
      totalCents: lines.reduce((sum, l) => sum + (l.lineTotalCents ?? 0), 0),
      /** Pominięte pozycje niespożywcze - tylko liczba (nie pokazujemy ich) */
      skipped: r.items.length - food.length,
      warnings: r.warnings.slice(0, 10),
    };
  }

  /** Zatwierdzone składniki dla AI (nazwy po jednej w linii) - w pamięci na godzinę, żeby prefiks był stały */
  private async catalog(): Promise<Catalog> {
    if (this.catalogCache && Date.now() - this.catalogCache.at < CATALOG_TTL_MS)
      return this.catalogCache.value;
    const rows = await this.prisma.ingredient.findMany({
      where: { status: 'APPROVED' },
      select: { id: true, namePl: true },
      orderBy: { namePl: 'asc' },
    });
    const value: Catalog = {
      text: rows.map((r) => r.namePl).join('\n'),
      byName: new Map(rows.map((r) => [r.namePl.toLowerCase(), r.id])),
    };
    this.catalogCache = { at: Date.now(), value };
    return value;
  }

  private async loadItems(ids: string[]): Promise<Map<string, LineIngredient>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.ingredient.findMany({
      where: { id: { in: ids } },
      include: {
        category: true,
        units: { include: { unit: true }, orderBy: { unit: { sortOrder: 'asc' } } },
      },
    });
    return new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          namePl: r.namePl,
          nameEn: r.nameEn,
          density: r.density,
          units: r.units.map((u) => ({
            code: u.unitCode,
            namePl: u.unit.namePl,
            nameEn: u.unit.nameEn,
            grams: u.grams,
          })),
          category: { icon: r.category.icon },
        },
      ]),
    );
  }

  /** Cennik o nazwie sklepu (np. "Biedronka"), inaczej domyślny; null = trzeba założyć */
  private async suggestList(scope: OwnerScope, store: string | null): Promise<string | null> {
    const lists = await this.prisma.priceList.findMany({ where: scope, orderBy: { createdAt: 'asc' } });
    const s = store ? normalizeSearch(store) : '';
    const byStore = s
      ? lists.find((l) => {
          const n = normalizeSearch(l.name);
          return n.length >= 3 && (s === n || s.includes(n) || n.includes(s));
        })
      : undefined;
    return (byStore ?? lists.find((l) => l.isDefault) ?? null)?.id ?? null;
  }

  // --- 2. Zatwierdzenie: jedna transakcja, odporna na ponowne kliknięcie ---------------

  async commit(user: AuthUser, importId: string, dto: ReceiptCommitDto): Promise<CommitResult> {
    const record = await this.prisma.aiImport.findFirst({
      where: { id: importId, userId: user.id, kind: 'RECEIPT', success: true },
    });
    if (!record) throw new NotFoundException({ code: 'NOT_FOUND' });
    // Już zatwierdzony - zwracamy ten sam wynik, niczego nie dublujemy
    if (record.committedAt) return record.result as unknown as CommitResult;
    if (Date.now() - record.createdAt.getTime() > COMMIT_WINDOW_MS) {
      throw new HttpException({ code: 'IMPORT_EXPIRED' }, HttpStatus.GONE);
    }
    const scope = await ownerScope(this.prisma, user.id);
    if (scopeKey(scope) !== record.scopeKey) throw new ConflictException({ code: 'HOUSEHOLD_CHANGED' });

    const pantryLines = dto.toPantry ? dto.lines.filter((l) => l.toPantry) : [];
    const priceLines = dto.toPrices ? dto.lines.filter((l) => l.toPrices) : [];
    if (!pantryLines.length && !priceLines.length) {
      throw new BadRequestException({ code: 'RECEIPT_NOTHING_SELECTED' });
    }
    if (priceLines.some((l) => !l.price)) throw new BadRequestException({ code: 'PRICE_INVALID' });
    if (priceLines.length && !dto.listId && !dto.newList) {
      throw new BadRequestException({ code: 'PRICE_LIST_REQUIRED' });
    }
    if (dto.newList && (dto.newList.currency ?? 'PLN') !== dto.currency) {
      throw new BadRequestException({ code: 'CURRENCY_MISMATCH' });
    }

    // Składniki i wagi opakowań sprawdzamy przed transakcją (dane z przeglądarki są niezaufane)
    const ids = [...new Set([...pantryLines, ...priceLines].map((l) => l.ingredientId))];
    const rows = await this.prisma.ingredient.findMany({
      where: { id: { in: ids } },
      include: { units: true },
    });
    const byId = new Map(
      rows
        .filter(
          (i) =>
            i.status === 'APPROVED' ||
            i.createdById === user.id ||
            user.role === 'ADMIN' ||
            user.role === 'SUPER_ADMIN',
        )
        .map((i) => [i.id, i]),
    );
    if (byId.size !== ids.length) throw new NotFoundException({ code: 'INGREDIENT_UNKNOWN' });
    const packageGrams = new Map<(typeof dto.lines)[number], number>();
    for (const line of new Set([...pantryLines, ...priceLines])) {
      packageGrams.set(
        line,
        await this.prices.packageGrams(
          byId.get(line.ingredientId)!,
          line.packageAmount,
          line.packageUnitCode,
        ),
      );
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Rezerwujemy import - drugie, równoległe zatwierdzenie czeka tu i dostaje count 0
          const claimed = await tx.aiImport.updateMany({
            where: { id: record.id, committedAt: null },
            data: { committedAt: new Date() },
          });
          if (!claimed.count) throw new AlreadyCommitted();

          let list: CommitResult['list'] = null;
          let listId: string | null = null;
          if (priceLines.length) {
            const row = dto.newList
              ? await this.prices.createList(scope, dto.newList, tx)
              : await this.prices.findList(scope, dto.listId!, tx);
            if (row.currency !== dto.currency) throw new BadRequestException({ code: 'CURRENCY_MISMATCH' });
            list = { id: row.id, name: row.name, created: !!dto.newList };
            listId = row.id;
          }

          for (const line of pantryLines) {
            const grams = line.packages * packageGrams.get(line)!;
            const amount = Math.round(line.packages * line.packageAmount * 1000) / 1000;
            await this.pantry.addGrams(
              scope,
              line.ingredientId,
              Math.round(grams * 10) / 10,
              { amount, unitCode: line.packageUnitCode },
              tx,
            );
          }

          const purchasedOn = dto.purchasedOn ? toDate(dto.purchasedOn) : null;
          for (const line of priceLines) {
            const entry = {
              packageAmount: line.packageAmount,
              packageUnitCode: line.packageUnitCode,
              priceCents: toCents(line.price!),
            };
            await this.prices.upsertEntry(listId!, byId.get(line.ingredientId)!, entry, tx);
            await tx.priceObservation.create({
              data: {
                ...scope,
                listId: listId!,
                ingredientId: line.ingredientId,
                importId: record.id,
                source: 'RECEIPT',
                storeName: dto.store || null,
                purchasedOn,
                currency: dto.currency,
                ...entry,
                packageGrams: packageGrams.get(line)!,
                packages: line.packages,
              },
            });
          }

          // Zatwierdzone pozycje to głosy "ten tekst z paragonu = ten składnik" (także bez zmian)
          const stored = record.lines as unknown as StoredLines | null;
          if (stored) {
            const byKey = new Map(stored.items.map((i) => [i.key, i.textKey]));
            await this.aliases.vote(
              user.id,
              stored.storeKey,
              [...pantryLines, ...priceLines]
                .filter((l) => l.key !== undefined && byKey.has(l.key))
                .map((l) => ({ textKey: byKey.get(l.key!)!, ingredientId: l.ingredientId })),
              tx,
            );
          }

          const result: CommitResult = { pantry: pantryLines.length, prices: priceLines.length, list };
          await tx.aiImport.update({
            where: { id: record.id },
            // Nazwy produktów nie są już potrzebne - nie trzymamy listy zakupów dłużej niż trzeba
            data: { result: result as unknown as Prisma.InputJsonValue, lines: Prisma.DbNull },
          });
          return result;
        },
        { timeout: 30_000 },
      );
    } catch (err) {
      if (err instanceof AlreadyCommitted) {
        const done = await this.prisma.aiImport.findUniqueOrThrow({ where: { id: record.id } });
        return done.result as unknown as CommitResult;
      }
      // Równoległe założenie domyślnego cennika przez domownika (unikalny indeks) - do ponowienia
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException({ code: 'PRICE_LIST_CONFLICT' });
      }
      throw err;
    }
  }
}

class AlreadyCommitted extends Error {}
