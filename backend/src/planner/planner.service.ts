import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../common/auth.decorators.js';
import type { Prisma } from '../generated/prisma/client.js';
import { toPhotoDto } from '../photos/photos.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toDependentDto } from '../household/household.service.js';
import { DEFAULT_KCAL } from '../household/reference-energy.js';
import type { Targets } from '../profile/nutrition-calculator.js';
import { ProfileService } from '../profile/profile.service.js';
import { RecipesService } from '../recipes/recipes.service.js';
import {
  STANDARD_SLOTS,
  type AddMealDto,
  type CopyDto,
  type PlannerSettingsDto,
  type StandardSlot,
  type UpdateMealDto,
} from './planner.dto.js';
import { potGrams, splitMeal, type Person } from './portions.js';

/** Po ilu dniach od ugotowania ostrzegamy o świeżości (lodówka ~3 dni) */
export const FRESH_DAYS = 3;
/** Najdłuższy zakres pobierany naraz */
const MAX_RANGE_DAYS = 42;
const MAX_CUSTOM_SLOTS = 6;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Tolerancja porównań porcji (ułamki typu 1/3) */
const EPS = 1e-6;

type Tx = Prisma.TransactionClient;
/** Właściciel planu: gospodarstwo albo sam użytkownik */
type Scope = { householdId: string; userId?: undefined } | { userId: string; householdId?: undefined };

export const toDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) {
    throw new BadRequestException({ code: 'DATE_INVALID' });
  }
  return d;
};
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY_MS);

const RECIPE_SELECT = {
  id: true,
  title: true,
  servings: true,
  kcal: true,
  protein: true,
  fat: true,
  carbs: true,
  kcalPerServing: true,
  cookedGrams: true,
  totalGrams: true,
  visibility: true,
  hiddenAt: true,
  authorId: true,
  photos: { where: { position: { not: null } }, orderBy: { position: 'asc' }, take: 1 },
  allergens: { include: { allergen: true } },
} satisfies Prisma.RecipeSelect;

type RecipeRow = Prisma.RecipeGetPayload<{ select: typeof RECIPE_SELECT }>;

/**
 * Planer tygodniowy. Model: "gotowanie" (PlanCook) = przepis ugotowany w N porcjach,
 * "posiłek" (PlanMeal) = część tych porcji zjedzona danego dnia. Jedno gotowanie może
 * wystarczyć na kilka posiłków (gotowanie na zapas); dzień gotowania = dzień pierwszego posiłku.
 */
@Injectable()
export class PlannerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recipes: RecipesService,
    private readonly profile: ProfileService,
  ) {}

  async get(user: AuthUser, fromIso: string, toIso: string) {
    const from = toDate(fromIso);
    const to = toDate(toIso);
    const span = daysBetween(from, to);
    if (span < 0 || span >= MAX_RANGE_DAYS) throw new BadRequestException({ code: 'DATE_RANGE_INVALID' });

    const scope = await this.scope(user.id);
    const [settings, customSlots, people, meals, leftovers, me, mine] = await Promise.all([
      this.prisma.plannerSettings.findFirst({ where: scope }),
      this.prisma.customMealSlot.findMany({
        where: scope,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      this.people(scope),
      this.prisma.planMeal.findMany({
        where: { ...scope, date: { gte: from, lte: to } },
        include: {
          cook: { include: { recipe: { select: RECIPE_SELECT }, meals: { select: { servings: true } } } },
        },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      }),
      // Zapasy: partie ugotowane niedawno, z których zostały porcje
      this.prisma.planCook.findMany({
        where: { ...scope, date: { gte: addDays(from, -7), lte: to } },
        include: { recipe: { select: RECIPE_SELECT }, meals: { select: { servings: true } } },
        orderBy: { date: 'asc' },
      }),
      this.profile.get(user.id),
      this.myAllergens(user.id),
    ]);

    const hidden = new Set(settings?.hiddenSlots ?? []);
    const exact = settings?.exactPortions ?? false;
    const persons = exact ? await this.persons(user.id, scope, me.targets) : [];
    const myKey = `u:${user.id}`;
    return {
      scope: scope.householdId ? 'HOUSEHOLD' : 'USER',
      /** Na ile osób dzielimy porcje w trybie prostym */
      people,
      freshDays: FRESH_DAYS,
      settings: { hiddenSlots: [...hidden], exactPortions: settings?.exactPortions ?? false },
      slots: [
        ...STANDARD_SLOTS.map((code) => ({ key: code, code, name: null, hidden: hidden.has(code) })),
        ...customSlots.map((s) => ({ key: s.id, code: null, name: s.name, hidden: false })),
      ],
      targets: me.targets,
      /** Tryb dokładny: kto je i jaki ma cel (waga przy podziale) */
      persons,
      meals: meals.map((m) => {
        const allocated = sum(m.cook.meals.map((x) => x.servings));
        const age = daysBetween(m.cook.date, m.date);
        const pot = potGrams(m.cook, m.cook.recipe);
        const absent = [
          ...m.absentUserIds.map((id) => `u:${id}`),
          ...m.absentDependentIds.map((id) => `d:${id}`),
        ];
        const shares = exact
          ? splitMeal(persons, new Set(absent), {
              servings: m.servings,
              grams: pot.grams === null ? null : (pot.grams * m.servings) / m.cook.servings,
              kcalPerServing: m.cook.recipe.kcalPerServing,
            })
          : null;
        return {
          id: m.id,
          date: isoDate(m.date),
          slot: m.slotCode ?? m.customSlotId!,
          servings: m.servings,
          /** Moja część: w trybie prostym po równo, w dokładnym wg celów kcal */
          myServings: shares ? (shares.find((s) => s.key === myKey)?.servings ?? 0) : m.servings / people,
          absent,
          shares,
          grams: pot.grams === null ? null : Math.round((pot.grams * m.servings) / m.cook.servings),
          cook: {
            id: m.cook.id,
            date: isoDate(m.cook.date),
            servings: m.cook.servings,
            remaining: round(m.cook.servings - allocated),
            mealsCount: m.cook.meals.length,
            potGrams: pot.grams === null ? null : Math.round(pot.grams),
            gramsSource: pot.source,
          },
          /** Posiłek z wcześniej ugotowanej partii (resztki) */
          fromLeftovers: age > 0,
          daysAfterCooking: age,
          stale: age > FRESH_DAYS,
          recipe: toRecipeDto(m.cook.recipe, mine),
        };
      }),
      leftovers: leftovers
        .map((c) => ({ c, remaining: round(c.servings - sum(c.meals.map((x) => x.servings))) }))
        .filter(({ remaining }) => remaining > EPS)
        .map(({ c, remaining }) => ({
          cookId: c.id,
          date: isoDate(c.date),
          servings: c.servings,
          remaining,
          recipe: toRecipeDto(c.recipe, mine),
        })),
    };
  }

  async addMeal(user: AuthUser, dto: AddMealDto) {
    const scope = await this.scope(user.id);
    const date = toDate(dto.date);
    const slot = await this.resolveSlot(scope, dto.slot);
    if (!!dto.recipeId === !!dto.cookId) throw new BadRequestException({ code: 'MEAL_SOURCE_INVALID' });

    return this.prisma.$transaction(async (tx) => {
      let cookId = dto.cookId;
      if (dto.recipeId) {
        // Rzuci NOT_FOUND, jeśli przepisu nie widać
        await this.recipes.get(dto.recipeId, user);
        const cookServings = dto.cookServings ?? dto.servings;
        if (cookServings + EPS < dto.servings) throw new BadRequestException({ code: 'PORTIONS_EXCEEDED' });
        const cook = await tx.planCook.create({
          data: { ...scope, recipeId: dto.recipeId, date, servings: cookServings, createdById: user.id },
        });
        cookId = cook.id;
      } else {
        const cook = await this.findCook(tx, scope, cookId!);
        const allocated = sum(cook.meals.map((m) => m.servings));
        if (allocated + dto.servings > cook.servings + EPS) {
          throw new ConflictException({ code: 'PORTIONS_EXCEEDED' });
        }
      }
      const meal = await tx.planMeal.create({
        data: { ...scope, date, ...slot, cookId: cookId!, servings: dto.servings },
      });
      await this.syncCookDate(tx, cookId!);
      return { id: meal.id };
    });
  }

  async updateMeal(userId: string, id: string, dto: UpdateMealDto) {
    const scope = await this.scope(userId);
    await this.prisma.$transaction(async (tx) => {
      const meal = await tx.planMeal.findFirst({
        where: { id, ...scope },
        include: { cook: { include: { meals: true } } },
      });
      if (!meal) throw new NotFoundException({ code: 'NOT_FOUND' });
      const data: Prisma.PlanMealUncheckedUpdateInput = {};
      if (dto.date) data.date = toDate(dto.date);
      if (dto.slot) Object.assign(data, await this.resolveSlot(scope, dto.slot));

      if (dto.servings !== undefined && Math.abs(dto.servings - meal.servings) > EPS) {
        const others = sum(meal.cook.meals.filter((m) => m.id !== id).map((m) => m.servings));
        if (meal.cook.meals.length === 1 && Math.abs(meal.cook.servings - meal.servings) < EPS) {
          // Zwykły posiłek bez zapasu: zmiana porcji zmienia też gotowanie
          await tx.planCook.update({ where: { id: meal.cookId }, data: { servings: dto.servings } });
        } else if (others + dto.servings > meal.cook.servings + EPS) {
          throw new ConflictException({ code: 'PORTIONS_EXCEEDED' });
        }
        data.servings = dto.servings;
      }
      await tx.planMeal.update({ where: { id }, data });
      await this.syncCookDate(tx, meal.cookId);
    });
  }

  async deleteMeal(userId: string, id: string): Promise<void> {
    const scope = await this.scope(userId);
    await this.prisma.$transaction(async (tx) => {
      const meal = await tx.planMeal.findFirst({ where: { id, ...scope } });
      if (!meal) throw new NotFoundException({ code: 'NOT_FOUND' });
      await tx.planMeal.delete({ where: { id } });
      await this.syncCookDate(tx, meal.cookId);
    });
  }

  /** Tryb dokładny: kto nie je tego posiłku (klucze osób 'u:<id>' / 'd:<id>') */
  async setAbsent(user: AuthUser, id: string, keys: string[]): Promise<void> {
    const scope = await this.scope(user.id);
    const meal = await this.prisma.planMeal.findFirst({ where: { id, ...scope } });
    if (!meal) throw new NotFoundException({ code: 'NOT_FOUND' });
    const known = new Set((await this.persons(user.id, scope, null)).map((p) => p.key));
    if (keys.some((k) => !known.has(k))) throw new BadRequestException({ code: 'PERSON_UNKNOWN' });
    await this.prisma.planMeal.update({
      where: { id },
      data: {
        absentUserIds: keys.filter((k) => k.startsWith('u:')).map((k) => k.slice(2)),
        absentDependentIds: keys.filter((k) => k.startsWith('d:')).map((k) => k.slice(2)),
      },
    });
  }

  /** Zważona waga całej partii (null = wróć do wagi z przepisu) */
  async setCookWeight(userId: string, id: string, cookedGrams: number | null): Promise<void> {
    const scope = await this.scope(userId);
    const { count } = await this.prisma.planCook.updateMany({
      where: { id, ...scope },
      data: { cookedGrams },
    });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
  }

  /** Zmiana liczby ugotowanych porcji (nie mniej niż już rozdysponowano) */
  async updateCook(userId: string, id: string, servings: number): Promise<void> {
    const scope = await this.scope(userId);
    await this.prisma.$transaction(async (tx) => {
      const cook = await this.findCook(tx, scope, id);
      if (sum(cook.meals.map((m) => m.servings)) > servings + EPS) {
        throw new ConflictException({ code: 'PORTIONS_EXCEEDED' });
      }
      await tx.planCook.update({ where: { id }, data: { servings } });
    });
  }

  async deleteCook(userId: string, id: string): Promise<void> {
    const scope = await this.scope(userId);
    const { count } = await this.prisma.planCook.deleteMany({ where: { id, ...scope } });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
  }

  /**
   * Kopiuje dzień albo tydzień. Każda partia dostaje kopię z porcjami posiłków,
   * które mieszczą się w kopiowanym zakresie (resztki spoza zakresu nie przechodzą).
   */
  async copy(userId: string, dto: CopyDto): Promise<{ copied: number }> {
    const scope = await this.scope(userId);
    const from = toDate(dto.from);
    const to = toDate(dto.to);
    const shift = daysBetween(from, to);
    if (shift === 0) throw new BadRequestException({ code: 'DATE_RANGE_INVALID' });
    const end = addDays(from, dto.days - 1);

    return this.prisma.$transaction(async (tx) => {
      const meals = await tx.planMeal.findMany({
        where: { ...scope, date: { gte: from, lte: end } },
        include: { cook: true },
        orderBy: { date: 'asc' },
      });
      const byCook = new Map<string, typeof meals>();
      for (const m of meals) byCook.set(m.cookId, [...(byCook.get(m.cookId) ?? []), m]);

      for (const group of byCook.values()) {
        const source = group[0].cook;
        const cook = await tx.planCook.create({
          data: {
            ...scope,
            recipeId: source.recipeId,
            date: addDays(group[0].date, shift),
            servings: sum(group.map((m) => m.servings)),
            createdById: userId,
          },
        });
        await tx.planMeal.createMany({
          data: group.map((m) => ({
            ...scope,
            date: addDays(m.date, shift),
            slotCode: m.slotCode,
            customSlotId: m.customSlotId,
            cookId: cook.id,
            servings: m.servings,
          })),
        });
      }
      return { copied: meals.length };
    });
  }

  /** Czyści zakres dat; partie bez posiłków znikają */
  async clear(userId: string, fromIso: string, toIso: string): Promise<void> {
    const scope = await this.scope(userId);
    const from = toDate(fromIso);
    const to = toDate(toIso);
    if (daysBetween(from, to) < 0 || daysBetween(from, to) >= MAX_RANGE_DAYS) {
      throw new BadRequestException({ code: 'DATE_RANGE_INVALID' });
    }
    await this.prisma.$transaction(async (tx) => {
      const meals = await tx.planMeal.findMany({
        where: { ...scope, date: { gte: from, lte: to } },
        select: { cookId: true },
      });
      await tx.planMeal.deleteMany({ where: { ...scope, date: { gte: from, lte: to } } });
      for (const cookId of new Set(meals.map((m) => m.cookId))) await this.syncCookDate(tx, cookId);
    });
  }

  // --- Ustawienia i własne posiłki ---------------------------------------------------

  async saveSettings(userId: string, dto: PlannerSettingsDto) {
    const scope = await this.scope(userId);
    const existing = await this.prisma.plannerSettings.findFirst({ where: scope });
    const data = {
      hiddenSlots: dto.hiddenSlots,
      ...(dto.exactPortions !== undefined ? { exactPortions: dto.exactPortions } : {}),
    };
    const saved = existing
      ? await this.prisma.plannerSettings.update({ where: { id: existing.id }, data })
      : await this.prisma.plannerSettings.create({ data: { ...scope, ...data } });
    return { hiddenSlots: saved.hiddenSlots, exactPortions: saved.exactPortions };
  }

  async addSlot(userId: string, name: string) {
    const scope = await this.scope(userId);
    const count = await this.prisma.customMealSlot.count({ where: scope });
    if (count >= MAX_CUSTOM_SLOTS) throw new ConflictException({ code: 'TOO_MANY_SLOTS' });
    const slot = await this.prisma.customMealSlot.create({ data: { ...scope, name, sortOrder: count } });
    return { key: slot.id, code: null, name: slot.name, hidden: false };
  }

  async renameSlot(userId: string, id: string, name: string): Promise<void> {
    const scope = await this.scope(userId);
    const { count } = await this.prisma.customMealSlot.updateMany({
      where: { id, ...scope },
      data: { name },
    });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
  }

  /** Usunięcie własnego posiłku usuwa zaplanowane w nim dania */
  async deleteSlot(userId: string, id: string): Promise<void> {
    const scope = await this.scope(userId);
    await this.prisma.$transaction(async (tx) => {
      const slot = await tx.customMealSlot.findFirst({ where: { id, ...scope } });
      if (!slot) throw new NotFoundException({ code: 'NOT_FOUND' });
      const meals = await tx.planMeal.findMany({ where: { customSlotId: id }, select: { cookId: true } });
      await tx.customMealSlot.delete({ where: { id } });
      for (const cookId of new Set(meals.map((m) => m.cookId))) await this.syncCookDate(tx, cookId);
    });
  }

  // ---------------------------------------------------------------------------

  private async scope(userId: string): Promise<Scope> {
    const member = await this.prisma.householdMember.findUnique({ where: { userId } });
    return member ? { householdId: member.householdId } : { userId };
  }

  /** Liczba osób w gospodarstwie (z dziećmi bez konta) */
  private async people(scope: Scope): Promise<number> {
    if (!scope.householdId) return 1;
    const [members, dependents] = await Promise.all([
      this.prisma.householdMember.count({ where: { householdId: scope.householdId } }),
      this.prisma.householdDependent.count({ where: { householdId: scope.householdId } }),
    ]);
    return members + dependents;
  }

  /**
   * Osoby do podziału porcji. Cel kcal domownika z kontem używamy tylko za jego zgodą
   * (dane pochodne od danych o zdrowiu); bez niej - neutralna wartość referencyjna.
   */
  private async persons(userId: string, scope: Scope, myTargets: Targets | null) {
    const me = { key: `u:${userId}`, kind: 'MEMBER' as const, isMe: true };
    if (!scope.householdId) {
      const username = (await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })).username;
      return [personOut({ ...me, name: username }, myTargets?.kcal, 'PROFILE')];
    }
    const [members, dependents] = await Promise.all([
      this.prisma.householdMember.findMany({
        where: { householdId: scope.householdId },
        include: { user: { select: { username: true } } },
        orderBy: { joinedAt: 'asc' },
      }),
      this.prisma.householdDependent.findMany({
        where: { householdId: scope.householdId },
        orderBy: { birthYear: 'asc' },
      }),
    ]);
    const out = [];
    for (const m of members) {
      const base = {
        key: `u:${m.userId}`,
        kind: 'MEMBER' as const,
        isMe: m.userId === userId,
        name: m.user.username,
      };
      if (base.isMe) out.push(personOut(base, myTargets?.kcal, 'PROFILE'));
      else if (m.shareTargets)
        out.push(personOut(base, (await this.profile.get(m.userId)).targets?.kcal, 'PROFILE'));
      else out.push(personOut(base, undefined, 'PROFILE'));
    }
    for (const d of dependents) {
      const dto = toDependentDto(d);
      out.push({
        key: `d:${d.id}`,
        kind: 'DEPENDENT' as const,
        isMe: false,
        name: d.name,
        kcal: dto.kcal,
        source: dto.reference ? ('REFERENCE' as const) : ('CUSTOM' as const),
      });
    }
    return out;
  }

  private async myAllergens(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.userAllergen.findMany({ where: { userId }, include: { allergen: true } });
    return new Set(rows.map((r) => r.allergen.code));
  }

  private async resolveSlot(scope: Scope, slot: string) {
    if ((STANDARD_SLOTS as readonly string[]).includes(slot)) {
      return { slotCode: slot as StandardSlot, customSlotId: null };
    }
    const custom = /^[0-9a-f-]{36}$/i.test(slot)
      ? await this.prisma.customMealSlot.findFirst({ where: { id: slot, ...scope } })
      : null;
    if (!custom) throw new BadRequestException({ code: 'SLOT_UNKNOWN' });
    return { slotCode: null, customSlotId: custom.id };
  }

  private async findCook(tx: Tx, scope: Scope, id: string) {
    const cook = await tx.planCook.findFirst({ where: { id, ...scope }, include: { meals: true } });
    if (!cook) throw new NotFoundException({ code: 'NOT_FOUND' });
    return cook;
  }

  /** Dzień gotowania = najwcześniejszy posiłek; partia bez posiłków jest usuwana */
  private async syncCookDate(tx: Tx, cookId: string): Promise<void> {
    const first = await tx.planMeal.findFirst({ where: { cookId }, orderBy: { date: 'asc' } });
    if (!first) await tx.planCook.deleteMany({ where: { id: cookId } });
    else await tx.planCook.update({ where: { id: cookId }, data: { date: first.date } });
  }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const round = (x: number) => Math.round(x * 100) / 100;

function toRecipeDto(r: RecipeRow, myAllergens: Set<string>) {
  const per = (v: number) => (r.servings > 0 ? v / r.servings : 0);
  return {
    id: r.id,
    title: r.title,
    servings: r.servings,
    /** Wartości na 1 porcję przepisu */
    perServing: { kcal: r.kcalPerServing, protein: per(r.protein), fat: per(r.fat), carbs: per(r.carbs) },
    cover: r.photos[0] ? toPhotoDto(r.photos[0]) : null,
    allergens: r.allergens.map((a) => a.allergen.code),
    myAllergens: r.allergens.map((a) => a.allergen.code).filter((c) => myAllergens.has(c)),
  };
}

/** Osoba z wagą do podziału; brak celu (albo brak zgody) = neutralne 2000 kcal */
function personOut(
  p: { key: string; kind: 'MEMBER'; isMe: boolean; name: string },
  kcal: number | undefined,
  source: 'PROFILE',
): Person & { kind: 'MEMBER' | 'DEPENDENT'; isMe: boolean; name: string; source: string } {
  return kcal ? { ...p, kcal, source } : { ...p, kcal: DEFAULT_KCAL, source: 'DEFAULT' };
}
