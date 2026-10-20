import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiUsageService } from '../ai/ai-usage.service.js';
import type { AuthUser } from '../common/auth.decorators.js';
import { ownerScope } from '../common/owner-scope.js';
import type { AiImportKind } from '../generated/prisma/client.js';
import { PantryService } from '../pantry/pantry.service.js';
import { STANDARD_SLOTS } from '../planner/planner.dto.js';
import { PlannerService } from '../planner/planner.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProfileService } from '../profile/profile.service.js';
import { RecipeImportService } from '../recipe-import/recipe-import.service.js';
import { ListRecipesQuery } from '../recipes/recipes.dto.js';
import { RecipesService } from '../recipes/recipes.service.js';
import { LIQUID_CATEGORIES, shoppingAmount } from '../shopping/shopping-math.js';
import { ShoppingService } from '../shopping/shopping.service.js';
import { AssistantAi, type AiResult } from './assistant-ai.js';
import { duePurchases, toPlannerMeals, type ProposedMeal } from './assistant-math.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Kandydaci na posiłek (na rodzaj posiłku) i do "z lodówki" - więcej nie poprawia wyboru, a kosztuje */
const PLAN_CANDIDATES = 40;
const PANTRY_CANDIDATES = 30;
/** Historia zakupów z paragonów do "co się kończy" */
const PURCHASE_WINDOW_DAYS = 120;

export type AssistantAction = 'PLAN' | 'PANTRY' | 'SHOPPING';
export type VariantKind = 'VEGAN' | 'GLUTEN_FREE' | 'LACTOSE_FREE' | 'LIGHTER' | 'FASTER' | 'FROM_PANTRY';

/** Rodzaje przepisów pasujące do posiłku w planerze */
const SLOT_MEAL_TYPES: Record<string, string[]> = {
  BREAKFAST: ['BREAKFAST'],
  SECOND_BREAKFAST: ['BREAKFAST', 'LUNCH', 'SNACK'],
  DINNER: ['DINNER', 'LUNCH'],
  AFTERNOON_SNACK: ['AFTERNOON_SNACK', 'SNACK'],
  SUPPER: ['SUPPER', 'BREAKFAST'],
  SNACK: ['SNACK', 'AFTERNOON_SNACK'],
};
const DEFAULT_SLOTS = ['BREAKFAST', 'DINNER', 'SUPPER'];

const VARIANT_ASK: Record<VariantKind, string> = {
  VEGAN: 'wersja wegańska (bez mięsa, ryb, nabiału, jaj i miodu)',
  GLUTEN_FREE: 'wersja bez glutenu',
  LACTOSE_FREE: 'wersja bez laktozy',
  LIGHTER: 'wersja lżejsza - o ok. 30% mniej kcal na porcję',
  FASTER: 'wersja szybsza - krócej w kuchni, prostsze kroki',
  FROM_PANTRY: 'wersja z tego, co mam w lodówce (zamień brakujące składniki na posiadane, gdzie to ma sens)',
};

type RecipeCard = Awaited<ReturnType<RecipesService['list']>>['items'][number];

function card(r: RecipeCard) {
  return {
    id: r.id,
    title: r.title,
    kcalPerServing: r.kcalPerServing,
    minutes: (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0) || null,
    cover: r.cover,
  };
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Asystent: zadania (plan tygodnia, przepisy z lodówki, uzupełnienie zakupów, wersja przepisu).
 * Każde kończy się szkicem do zatwierdzenia - zapis idzie przez istniejące mechanizmy (planer,
 * lista zakupów, formularz przepisu). Rozmów nie przechowujemy; liczymy tylko użycie (limity).
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AssistantAi,
    private readonly usage: AiUsageService,
    private readonly recipes: RecipesService,
    private readonly pantry: PantryService,
    private readonly shopping: ShoppingService,
    private readonly planner: PlannerService,
    private readonly profile: ProfileService,
    private readonly recipeImport: RecipeImportService,
  ) {}

  async status(userId: string) {
    return {
      enabled: this.ai.enabled,
      dailyLimit: this.usage.dailyLimit('ASSISTANT'),
      remaining: await this.usage.remaining(userId, 'ASSISTANT'),
    };
  }

  /** Prośba z pola tekstowego albo szybka akcja */
  async ask(user: AuthUser, dto: { text?: string; action?: AssistantAction; lang?: 'pl' | 'en' }) {
    if (!this.ai.enabled) throw new ServiceUnavailableException({ code: 'IMPORT_DISABLED' });
    const lang = dto.lang ?? 'pl';
    let task: AssistantAction | 'VARIANT' | 'OFF_TOPIC' = dto.action ?? 'OFF_TOPIC';
    let slots = DEFAULT_SLOTS;
    let days = 7;
    let wishes = '';
    if (!dto.action) {
      const text = (dto.text ?? '').trim();
      if (!text) throw new BadRequestException({ code: 'ASSISTANT_EMPTY' });
      // Tani krok: o co chodzi? Odmowy nie zużywają limitu zadań
      const route = await this.call('ASSISTANT_ROUTE', user.id, () => this.ai.route(text));
      task = route.task;
      if (route.slots.length) slots = route.slots;
      if (route.days && route.days >= 1 && route.days <= 7) days = route.days;
      wishes = route.wishes.slice(0, 300);
    }
    switch (task) {
      case 'PLAN':
        return this.plan(user, slots, days, wishes, lang);
      case 'PANTRY':
        return this.fromPantry(user, wishes, lang);
      case 'SHOPPING':
        return this.topUp(user);
      case 'VARIANT':
        return { type: 'MESSAGE', code: 'VARIANT_HINT' };
      default:
        return { type: 'MESSAGE', code: 'OFF_TOPIC' };
    }
  }

  // --- Plan tygodnia --------------------------------------------------------------------

  private async plan(user: AuthUser, slots: string[], days: number, wishes: string, lang: 'pl' | 'en') {
    const scope = await ownerScope(this.prisma, user.id);
    const start = new Date(Date.now() + DAY_MS);
    const dates = Array.from({ length: days }, (_, i) => isoDay(new Date(start.getTime() + i * DAY_MS)));
    const people = await this.planner.people(scope);

    // Kandydaci: przepisy "dla mnie" (alergie, preferencje) pasujące do rodzaju posiłku
    const aliases = new Map<string, RecipeCard>();
    const lines: string[] = [];
    for (const slot of slots) {
      const found = await this.recipes.list(
        Object.assign(new ListRecipesQuery(), {
          forMe: true,
          mealTypes: SLOT_MEAL_TYPES[slot] ?? [],
          sort: 'forYou',
          pageSize: PLAN_CANDIDATES,
          lang,
        }),
        user,
      );
      for (const r of found.items) {
        if ([...aliases.values()].some((a) => a.id === r.id)) continue;
        const code = `r${aliases.size + 1}`;
        aliases.set(code, r);
        lines.push(
          `${code} | ${r.title} | ${r.mealTypes.map((m) => m.namePl).join(', ')} | ${r.kcalPerServing ?? '?'} kcal/porcja | ${card(r).minutes ?? '?'} min`,
        );
      }
    }
    if (!aliases.size) return { type: 'MESSAGE', code: 'NO_RECIPES' };

    const kcal = await this.kcalTarget(user.id);
    const context = [
      `Dni planu: ${days} (dzień 1 = ${dates[0]}).`,
      `Posiłki do zaplanowania: ${slots.join(', ')}.`,
      `Osób w gospodarstwie: ${people}.`,
      kcal ? `Cel: ok. ${kcal} kcal dziennie na osobę.` : 'Brak celu kcal.',
      `Życzenia użytkownika: ${wishes || 'brak'}.`,
      'Przepisy (kod | tytuł | rodzaj | kcal | czas):',
      ...lines,
    ].join('\n');
    const reply = await this.call('ASSISTANT', user.id, () => this.ai.plan(context, lang));

    // Sprawdzamy odpowiedź: znane kody, dni i posiłki z prośby, jeden przepis na posiłek
    const seen = new Set<string>();
    const meals = reply.meals.filter((m) => {
      const key = `${m.day}|${m.slot}`;
      const ok =
        m.day >= 1 && m.day <= days && slots.includes(m.slot) && aliases.has(m.recipe) && !seen.has(key);
      if (ok) seen.add(key);
      return ok;
    });
    const byDay = dates.map((date, i) => ({
      date,
      meals: meals
        .filter((m) => m.day === i + 1)
        .sort((a, b) => STANDARD_SLOTS.indexOf(a.slot) - STANDARD_SLOTS.indexOf(b.slot))
        .map((m) => ({
          slot: m.slot,
          leftover: m.leftover,
          recipe: card(aliases.get(m.recipe)!),
          alternatives: m.alternatives
            .filter((a) => aliases.has(a) && a !== m.recipe)
            .slice(0, 2)
            .map((a) => card(aliases.get(a)!)),
        })),
    }));
    return { type: 'PLAN', summary: reply.summary.slice(0, 500), people, days: byDay };
  }

  /** Zatwierdzony plan → planer (partie dla resztek). Przepisy sprawdza planer (widoczność). */
  async applyPlan(
    user: AuthUser,
    dto: { meals: { date: string; slot: string; recipeId: string; leftover: boolean }[] },
  ) {
    const scope = await ownerScope(this.prisma, user.id);
    const people = await this.planner.people(scope);
    const dates = [...new Set(dto.meals.map((m) => m.date))].sort();
    const proposed: ProposedMeal[] = dto.meals.map((m) => ({
      day: dates.indexOf(m.date) + 1,
      slot: m.slot,
      recipeId: m.recipeId,
      leftover: m.leftover,
    }));
    const meals = toPlannerMeals(proposed, dates, people, STANDARD_SLOTS);
    const cookIds: string[] = [];
    for (const m of meals) {
      const source = m.fromIndex !== undefined ? cookIds[m.fromIndex] : undefined;
      if (source) {
        await this.planner.addMeal(user, {
          date: m.date,
          slot: m.slot,
          cookId: source,
          servings: m.servings,
        });
        cookIds.push('');
      } else {
        const created = await this.planner.addMeal(user, {
          date: m.date,
          slot: m.slot,
          recipeId: m.recipeId,
          servings: m.servings,
          cookServings: m.cookServings,
        });
        const meal = await this.prisma.planMeal.findUniqueOrThrow({ where: { id: created.id } });
        cookIds.push(meal.cookId);
      }
    }
    return { added: meals.length };
  }

  // --- Przepisy z lodówki ------------------------------------------------------------------

  private async fromPantry(user: AuthUser, wishes: string, lang: 'pl' | 'en') {
    const pantry = (await this.pantry.list(user.id)).items;
    if (!pantry.length) return { type: 'MESSAGE', code: 'PANTRY_EMPTY' };
    const have = new Set(pantry.map((p) => p.ingredient.id));
    const found = await this.recipes.list(
      Object.assign(new ListRecipesQuery(), {
        forMe: true,
        sort: 'fromPantry',
        pageSize: PANTRY_CANDIDATES,
        lang,
      }),
      user,
    );
    const lines = await this.prisma.recipeIngredient.findMany({
      where: { recipeId: { in: found.items.map((r) => r.id) }, ingredientId: { not: null } },
      include: { ingredient: { select: { id: true, namePl: true, nameEn: true } } },
    });
    const aliases = new Map<string, { recipe: RecipeCard; have: string[]; missing: string[] }>();
    const text: string[] = [];
    for (const r of found.items) {
      const ings = lines.filter((l) => l.recipeId === r.id && l.ingredient);
      const names = (pred: (id: string) => boolean) => [
        ...new Set(ings.filter((l) => pred(l.ingredient!.id)).map((l) => l.ingredient!.namePl)),
      ];
      const entry = { recipe: r, have: names((id) => have.has(id)), missing: names((id) => !have.has(id)) };
      if (!entry.have.length) continue;
      const code = `r${aliases.size + 1}`;
      aliases.set(code, entry);
      text.push(
        `${code} | ${r.title} | ma: ${entry.have.join(', ')} | brakuje: ${entry.missing.join(', ') || '-'} | ${r.kcalPerServing ?? '?'} kcal | ${card(r).minutes ?? '?'} min`,
      );
    }
    if (!aliases.size) return { type: 'MESSAGE', code: 'NO_RECIPES' };
    const expiring = pantry
      .filter((p) => p.daysLeft !== null && p.daysLeft <= 3)
      .map((p) => `${p.ingredient.namePl} (${p.daysLeft! < 0 ? 'po terminie' : `${p.daysLeft} dni`})`);
    const context = [
      `W lodówce: ${pantry.map((p) => p.ingredient.namePl).join(', ')}.`,
      `Kończy się termin: ${expiring.join(', ') || 'nic'}.`,
      `Życzenia użytkownika: ${wishes || 'brak'}.`,
      'Przepisy (kod | tytuł | ma | brakuje | kcal | czas):',
      ...text,
    ].join('\n');
    const reply = await this.call('ASSISTANT', user.id, () => this.ai.pantry(context, lang));
    const picks = reply.picks
      .filter((p, i, all) => aliases.has(p.recipe) && all.findIndex((x) => x.recipe === p.recipe) === i)
      .slice(0, 5)
      .map((p) => {
        const a = aliases.get(p.recipe)!;
        return {
          recipe: card(a.recipe),
          servings: a.recipe.servings,
          reason: p.reason.slice(0, 200),
          have: a.have,
          missing: a.missing,
        };
      });
    return { type: 'PANTRY', summary: reply.summary.slice(0, 500), recipes: picks };
  }

  // --- Uzupełnienie zakupów (bez AI - liczone z planu i historii paragonów) ------------------

  async topUp(user: AuthUser) {
    const scope = await ownerScope(this.prisma, user.id);
    const today = new Date();
    const plan = await this.shopping.planShortfall(
      user.id,
      isoDay(today),
      isoDay(new Date(today.getTime() + 6 * DAY_MS)),
    );

    const purchases = await this.prisma.priceObservation.findMany({
      where: {
        ...scope,
        source: 'RECEIPT',
        createdAt: { gte: new Date(today.getTime() - PURCHASE_WINDOW_DAYS * DAY_MS) },
      },
      select: { ingredientId: true, purchasedOn: true, createdAt: true, packageGrams: true, packages: true },
    });
    const due = duePurchases(
      purchases.map((p) => ({
        ingredientId: p.ingredientId,
        on: p.purchasedOn ?? p.createdAt,
        grams: p.packageGrams * p.packages,
      })),
      today,
    );
    const stock = await this.pantry.stock(scope);
    const onList = await this.shopping.unchecked(scope);
    const regular = due.filter((d) => {
      if (plan.has(d.ingredientId) || onList.has(d.ingredientId)) return false;
      const have = stock.get(d.ingredientId);
      // "mam" bez ilości albo jeszcze połowa typowego zakupu - nie podpowiadamy
      return have === undefined || (have !== null && have < d.grams * 0.5);
    });

    const ids = [...plan.keys(), ...regular.map((r) => r.ingredientId)];
    const ingredients = await this.prisma.ingredient.findMany({
      where: { id: { in: ids } },
      include: { category: true, units: true },
    });
    const byId = new Map(ingredients.map((i) => [i.id, i]));
    const item = (id: string, grams: number) => {
      const ing = byId.get(id)!;
      return {
        ingredient: { id, namePl: ing.namePl, nameEn: ing.nameEn, icon: ing.category.icon },
        grams: Math.round(grams),
        amount: shoppingAmount(grams, {
          pieceGrams: ing.units.find((u) => u.unitCode === 'PIECE')?.grams ?? null,
          density: ing.density,
          liquid: LIQUID_CATEGORIES.has(ing.category.code),
        }),
      };
    };
    return {
      type: 'SHOPPING',
      plan: [...plan.entries()]
        .filter(([id]) => byId.has(id))
        .map(([id, grams]) => ({ ...item(id, grams), reason: 'PLAN' })),
      regular: regular
        .filter((r) => byId.has(r.ingredientId))
        .map((r) => ({
          ...item(r.ingredientId, r.grams),
          reason: 'REGULAR',
          everyDays: r.everyDays,
          lastDaysAgo: r.lastDaysAgo,
        })),
    };
  }

  async applyShopping(user: AuthUser, dto: { items: { ingredientId: string; grams: number }[] }) {
    const ids = [...new Set(dto.items.map((i) => i.ingredientId))];
    const known = await this.prisma.ingredient.count({ where: { id: { in: ids }, status: 'APPROVED' } });
    if (known !== ids.length) throw new BadRequestException({ code: 'INGREDIENT_UNKNOWN' });
    return this.shopping.addNeeds(user.id, new Map(dto.items.map((i) => [i.ingredientId, i.grams])));
  }

  // --- Wersja przepisu -----------------------------------------------------------------------

  async variant(
    user: AuthUser,
    dto: { recipeId: string; kind: VariantKind; wish?: string; lang?: 'pl' | 'en' },
  ) {
    if (!this.ai.enabled) throw new ServiceUnavailableException({ code: 'IMPORT_DISABLED' });
    const lang = dto.lang ?? 'pl';
    const r = await this.recipes.get(dto.recipeId, user);
    const pantry = dto.kind === 'FROM_PANTRY' ? (await this.pantry.list(user.id)).items : [];
    const context = [
      `Prośba: ${VARIANT_ASK[dto.kind]}.`,
      dto.wish ? `Dodatkowe życzenie: ${dto.wish.slice(0, 200)}.` : '',
      pantry.length ? `W lodówce: ${pantry.map((p) => p.ingredient.namePl).join(', ')}.` : '',
      `Przepis: ${r.title} (${r.servings} porcji)`,
      r.description ? `Opis: ${r.description}` : '',
      'Składniki:',
      ...r.ingredients.map(
        (l) =>
          `- ${l.ingredient?.namePl ?? l.subRecipe?.title ?? '?'}: ${l.amount} ${l.unitCode}${l.note ? ` (${l.note})` : ''}`,
      ),
      'Kroki:',
      ...r.steps.map((s, i) => `${i + 1}. ${s.text}`),
    ]
      .filter(Boolean)
      .join('\n');
    const reply = await this.call('ASSISTANT', user.id, () => this.ai.variant(context, lang));
    const draft = await this.recipeImport.toDraft({ ...reply, isRecipe: true }, user);
    return {
      type: 'VARIANT',
      recipeId: r.id,
      draft,
      changes: reply.changes
        .slice(0, 20)
        .map((c) => ({ change: c.change.slice(0, 200), why: c.why.slice(0, 300) })),
    };
  }

  // ---------------------------------------------------------------------------

  /** Cel kcal tylko za zgodą zdrowotną (dane o zdrowiu) */
  private async kcalTarget(userId: string): Promise<number | null> {
    const p = await this.profile.get(userId);
    return p.healthConsent && p.targets ? Math.round(p.targets.kcal) : null;
  }

  /** Limit → licznik → wywołanie → tokeny. Błąd modelu = 502 (próba i tak się liczy) */
  private async call<T>(kind: AiImportKind, userId: string, fn: () => Promise<AiResult<T>>): Promise<T> {
    await this.usage.assertAvailable(userId, kind);
    const id = await this.usage.start(userId, kind, 0);
    try {
      const result = await fn();
      await this.usage.finish(id, result);
      return result.output;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(`Zadanie asystenta nieudane: ${(err as Error).message}`);
      throw new HttpException({ code: 'IMPORT_FAILED' }, HttpStatus.BAD_GATEWAY);
    }
  }
}
