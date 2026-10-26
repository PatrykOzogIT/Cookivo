import { BadRequestException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AiUsageService } from '../ai/ai-usage.service.js';
import type { AuthUser } from '../common/auth.decorators.js';
import { normalizeSearch } from '../common/text.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
  UNIT_RANGES,
  checkEstimate,
  inUnitRange,
  isKitchenUnit,
  type KitchenUnit,
} from '../ingredients/kitchen-units.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecipeCalculatorService } from '../recipes/recipe-calculator.service.js';
import { UnitEstimator } from './unit-estimator.js';

const isAdmin = (user?: AuthUser) => user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

/**
 * Odpowiedź dla formularza przepisu: KNOWN - waga znana (z bazy albo właśnie oszacowana);
 * NOT_FIT - miara nie pasuje do składnika; ASK - formularz pyta autora (zakres w `range`).
 */
export type EstimateResult =
  | { status: 'KNOWN'; grams: number; basis: 'SOURCE' | 'AI' | 'ADMIN' }
  | { status: 'NOT_FIT' }
  | { status: 'ASK'; range: [number, number]; reason?: 'LIMIT' | 'DISABLED' | 'FAILED' };

/**
 * Wagi miar kuchennych składników: szacunek AI zapisywany od razu dla wszystkich (oznaczony),
 * propozycje użytkowników do akceptacji admina.
 */
@Injectable()
export class UnitEstimatesService {
  private readonly logger = new Logger(UnitEstimatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly estimator: UnitEstimator,
    private readonly usage: AiUsageService,
    private readonly calculator: RecipeCalculatorService,
  ) {}

  async estimate(ingredientId: string, unitCode: string, user: AuthUser): Promise<EstimateResult> {
    if (!isKitchenUnit(unitCode)) throw new BadRequestException({ code: 'UNIT_UNKNOWN' });
    const ing = await this.prisma.ingredient.findUnique({
      where: { id: ingredientId },
      include: { units: true, category: true },
    });
    const visible = ing && (ing.status === 'APPROVED' || isAdmin(user) || ing.createdById === user.id);
    if (!ing || !visible) throw new NotFoundException({ code: 'NOT_FOUND' });

    const unitMl = await this.calculator.unitMl();
    const known = knownGrams(ing, unitCode, unitMl);
    if (known) return { status: 'KNOWN', ...known };
    const ask = (reason?: 'LIMIT' | 'DISABLED' | 'FAILED'): EstimateResult => ({
      status: 'ASK',
      range: UNIT_RANGES[unitCode],
      ...(reason ? { reason } : {}),
    });
    if (ing.unitsNotFit.includes(unitCode)) return { status: 'NOT_FIT' };
    // AI pytamy o składnik raz - drugi raz nie zgadnie lepiej
    if (ing.unitsEstimatedAt) return ask();
    if (!this.estimator.enabled) return ask('DISABLED');
    try {
      await this.usage.assertAvailable(user.id, 'UNIT_ESTIMATE');
    } catch (err) {
      if (err instanceof HttpException) return ask('LIMIT');
      throw err;
    }

    const usageId = await this.usage.start(user.id, 'UNIT_ESTIMATE', 0);
    let checked: ReturnType<typeof checkEstimate>;
    try {
      const res = await this.estimator.estimate({
        namePl: ing.namePl,
        nameEn: ing.nameEn,
        category: ing.category.code,
      });
      await this.usage.finish(usageId, res);
      checked = checkEstimate(res.estimate);
    } catch (err) {
      this.logger.warn(`Szacunek miar nieudany: ${(err as Error).message}`);
      return ask('FAILED');
    }
    await this.saveEstimate(ing, checked, unitMl);
    // Miary jeszcze nie znaliśmy (wyżej), więc jeśli jest w szacunku - właśnie ją zapisaliśmy
    const grams = checked.grams[unitCode];
    if (grams !== undefined) return { status: 'KNOWN', grams, basis: 'AI' };
    return checked.notFit.includes(unitCode) ? { status: 'NOT_FIT' } : ask();
  }

  /** Zapis szacunku: tylko miary, których składnik nie zna (nigdy nie nadpisujemy) */
  private async saveEstimate(
    ing: { id: string; density: number | null; units: { unitCode: string }[] },
    checked: ReturnType<typeof checkEstimate>,
    unitMl: Record<string, number | null>,
  ): Promise<void> {
    const data = (Object.entries(checked.grams) as [KitchenUnit, number][])
      .filter(([code]) => !ing.units.some((u) => u.unitCode === code))
      // Łyżkę i szklankę płynu liczymy z gęstości - nie zapisujemy drugiego przelicznika
      .filter(([code]) => !(ing.density && unitMl[code]))
      .map(([unitCode, grams]) => ({ ingredientId: ing.id, unitCode, grams, basis: 'AI' as const }));
    await this.prisma.$transaction([
      this.prisma.ingredientUnit.createMany({ data, skipDuplicates: true }),
      this.prisma.ingredient.update({
        where: { id: ing.id },
        data: { unitsEstimatedAt: new Date(), unitsNotFit: checked.notFit },
      }),
    ]);
  }

  // --- Panel admina -------------------------------------------------------------

  async suggestions() {
    const rows = await this.prisma.unitSuggestion.findMany({
      where: { status: 'PENDING' },
      include: {
        ingredient: { select: { id: true, namePl: true, nameEn: true, units: true } },
        unit: true,
        user: { select: { username: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      ingredient: { id: r.ingredient.id, namePl: r.ingredient.namePl, nameEn: r.ingredient.nameEn },
      unit: { code: r.unit.code, namePl: r.unit.namePl, nameEn: r.unit.nameEn },
      grams: r.grams,
      /** Aktualna waga w bazie (np. szacunek AI), jeśli jest */
      current: r.ingredient.units.find((u) => u.unitCode === r.unitCode)?.grams ?? null,
      username: r.user?.username ?? null,
      createdAt: r.createdAt,
    }));
  }

  /** Szacunki AI do sprawdzenia (bez licznika spraw - może ich być dużo) */
  async estimates(q: string | undefined, page: number) {
    const pageSize = 50;
    const where: Prisma.IngredientUnitWhereInput = {
      basis: 'AI',
      ...(q ? { ingredient: { searchText: { contains: normalizeSearch(q) } } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.ingredientUnit.count({ where }),
      this.prisma.ingredientUnit.findMany({
        where,
        include: { ingredient: { select: { id: true, namePl: true, nameEn: true } }, unit: true },
        orderBy: [{ ingredient: { namePl: 'asc' } }, { unit: { sortOrder: 'asc' } }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: rows.map((r) => ({
        ingredient: r.ingredient,
        unit: { code: r.unit.code, namePl: r.unit.namePl, nameEn: r.unit.nameEn },
        grams: r.grams,
      })),
    };
  }

  async approve(id: string, grams?: number) {
    const s = await this.prisma.unitSuggestion.findUnique({ where: { id } });
    if (!s || s.status !== 'PENDING') throw new NotFoundException({ code: 'NOT_FOUND' });
    await this.setUnit(s.ingredientId, s.unitCode, grams ?? s.grams);
  }

  async reject(id: string): Promise<void> {
    const s = await this.prisma.unitSuggestion.findUnique({ where: { id } });
    if (!s || s.status !== 'PENDING') throw new NotFoundException({ code: 'NOT_FOUND' });
    // Przepis autora dalej liczy się z jego wagi (recipe_ingredients.unit_grams)
    await this.prisma.unitSuggestion.update({
      where: { id },
      data: { status: 'REJECTED', decidedAt: new Date() },
    });
  }

  /**
   * Waga miary zatwierdzona przez admina: dla wszystkich (basis ADMIN), zamyka propozycje tej pary,
   * przepisy przestają używać własnych wag autorów i są przeliczane.
   */
  async setUnit(ingredientId: string, unitCode: string, grams: number): Promise<void> {
    if (!inUnitRange(unitCode, grams)) throw new BadRequestException({ code: 'UNIT_GRAMS_INVALID' });
    const ing = await this.prisma.ingredient.findUnique({ where: { id: ingredientId } });
    if (!ing) throw new NotFoundException({ code: 'NOT_FOUND' });
    await this.prisma.$transaction([
      this.prisma.ingredientUnit.upsert({
        where: { ingredientId_unitCode: { ingredientId, unitCode } },
        create: { ingredientId, unitCode, grams, basis: 'ADMIN' },
        update: { grams, basis: 'ADMIN' },
      }),
      this.prisma.unitSuggestion.updateMany({
        where: { ingredientId, unitCode, status: 'PENDING' },
        data: { status: 'APPROVED', decidedAt: new Date() },
      }),
      this.prisma.recipeIngredient.updateMany({
        where: { ingredientId, unitCode, unitGrams: { not: null } },
        data: { unitGrams: null },
      }),
      this.prisma.ingredient.update({
        where: { id: ingredientId },
        data: { unitsNotFit: { set: ing.unitsNotFit.filter((c) => c !== unitCode) } },
      }),
    ]);
    await this.calculator.recalculateForIngredient(ingredientId);
  }
}

/** Waga miary znana bez pytania: własna jednostka składnika albo miara objętości z gęstości */
export function knownGrams(
  ing: {
    density: number | null;
    units: { unitCode: string; grams: number; basis: 'SOURCE' | 'AI' | 'ADMIN' }[];
  },
  unitCode: string,
  unitMl: Record<string, number | null>,
): { grams: number; basis: 'SOURCE' | 'AI' | 'ADMIN' } | null {
  const own = ing.units.find((u) => u.unitCode === unitCode);
  if (own) return { grams: own.grams, basis: own.basis };
  const ml = unitMl[unitCode];
  if (ml && ing.density) return { grams: Math.round(ml * ing.density * 10) / 10, basis: 'SOURCE' };
  return null;
}
