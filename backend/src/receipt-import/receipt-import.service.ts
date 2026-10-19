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
import type { Prisma } from '../generated/prisma/client.js';
import { IngredientsService } from '../ingredients/ingredients.service.js';
import { PantryService } from '../pantry/pantry.service.js';
import { CURRENCIES } from '../prices/prices.dto.js';
import { PricesService } from '../prices/prices.service.js';
import { toDate } from '../planner/planner.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecipeCalculatorService } from '../recipes/recipe-calculator.service.js';
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
function lineItem(c: Candidate) {
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
  ) {}

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

    let reading: ReceiptReading;
    try {
      const result = await this.extractor.extract(images, lang);
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
    return this.toDraft(importId, reading, scope, user);
  }

  /** Szkic: tylko produkty spożywcze, przeliczone ceny, dopasowanie do bazy i propozycja cennika */
  private async toDraft(importId: string, r: ReceiptReading, scope: OwnerScope, user: AuthUser) {
    const unitMl = await this.calculator.unitMl();
    const food = r.items
      .filter((i) => i.isFood && (i.totalPrice === null || i.totalPrice > 0))
      .slice(0, MAX_LINES);
    const lines = await Promise.all(
      food.map(async (item, index) => {
        const numbers = receiptLine(item);
        const { match, suggestions } = await matchIngredient(this.ingredients, item.name, user);
        let { packageAmount, packageUnitCode } = numbers;
        let warnings: string[] = numbers.warnings;
        if (match) {
          if (packageUnitCode && !unitAllowed(packageUnitCode, match, unitMl)) {
            // Np. "1 l" przy składniku bez gęstości - użytkownik poda wielkość sam
            packageAmount = null;
            packageUnitCode = null;
            warnings = [...warnings, 'UNIT_NOT_ALLOWED'];
          } else if (!packageUnitCode && match.units.some((u) => u.code === 'PIECE')) {
            // Sztuka bez gramatury (bułka, banan) - opakowanie = 1 szt. (gramy z bazy)
            packageAmount = 1;
            packageUnitCode = 'PIECE';
            warnings = warnings.filter((w) => w !== 'NO_PACKAGE_SIZE');
          }
        }
        return {
          key: index,
          text: item.text.slice(0, 120),
          name: item.name.trim().slice(0, 80),
          status: match ? 'MATCHED' : suggestions.length ? 'CONFIRM' : 'NOT_FOUND',
          ingredient: match ? lineItem(match) : null,
          suggestions: suggestions.map(lineItem),
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
    const currency = CURRENCIES.find((c) => c === r.currency?.trim().toUpperCase()) ?? null;
    const store = r.store?.trim().slice(0, 80) || null;
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

          const result: CommitResult = { pantry: pantryLines.length, prices: priceLines.length, list };
          await tx.aiImport.update({
            where: { id: record.id },
            data: { result: result as unknown as Prisma.InputJsonValue },
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
