import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Localized } from '../ingredients/ingredients.models';
import type { RecipeDraft } from '../recipes/recipe-import.api';
import type { Photo } from '../recipes/recipes.models';
import type { ShoppingAmount } from '../shopping/shopping.api';

export interface AssistantStatus {
  enabled: boolean;
  dailyLimit: number;
  remaining: number;
}

export type AssistantAction = 'PLAN' | 'PANTRY' | 'SHOPPING';
export type VariantKind = 'VEGAN' | 'GLUTEN_FREE' | 'LACTOSE_FREE' | 'LIGHTER' | 'FASTER' | 'FROM_PANTRY';

export interface RecipeCard {
  id: string;
  title: string;
  kcalPerServing: number | null;
  minutes: number | null;
  cover: Photo | null;
  /** Koszt porcji (plan) - null, gdy brakuje cen */
  costPerServingCents?: number | null;
}

export interface PlanMeal {
  slot: string;
  leftover: boolean;
  recipe: RecipeCard;
  alternatives: RecipeCard[];
}

export interface PlanResult {
  type: 'PLAN';
  summary: string;
  people: number;
  currency: string;
  /** Budżet z prośby (np. "do 150 zł") */
  budgetCents: number | null;
  days: { date: string; meals: PlanMeal[] }[];
}

export interface PantryResult {
  type: 'PANTRY';
  summary: string;
  recipes: { recipe: RecipeCard; servings: number; reason: string; have: string[]; missing: string[] }[];
}

export interface ShoppingSuggestion {
  ingredient: Localized & { id: string; icon: string };
  grams: number;
  amount: ShoppingAmount;
  reason: 'PLAN' | 'REGULAR';
  everyDays?: number;
  lastDaysAgo?: number;
}

export interface ShoppingResult {
  type: 'SHOPPING';
  plan: ShoppingSuggestion[];
  regular: ShoppingSuggestion[];
}

/** Odpowiedź bez wyniku: kod tłumaczony kluczem `assistant.message.<KOD>` */
export interface MessageResult {
  type: 'MESSAGE';
  code: 'OFF_TOPIC' | 'VARIANT_HINT' | 'PANTRY_EMPTY' | 'NO_RECIPES';
}

export interface VariantResult {
  type: 'VARIANT';
  recipeId: string;
  draft: RecipeDraft;
  changes: { change: string; why: string }[];
}

export interface ParsedItem {
  name: string;
  amount: number | null;
  unit: 'g' | 'kg' | 'ml' | 'l' | 'PIECE' | 'PACKAGE' | null;
  note: string | null;
  /** Dopasowany składnik z bazy (null = własna pozycja) */
  ingredient:
    | (Localized & {
        id: string;
        density: number | null;
        units: (Localized & { code: string; grams: number })[];
        icon: string;
      })
    | null;
}

export interface Substitute {
  options: { name: string; amount: string; note: string; inPantry: boolean }[];
  tip: string | null;
}

export type AssistantResult = PlanResult | PantryResult | ShoppingResult | MessageResult;

/** Asystent: zadania kończą się szkicem - zapis przez planer, listę zakupów, formularz przepisu */
@Injectable({ providedIn: 'root' })
export class AssistantApi {
  private readonly http = inject(HttpClient);

  status(): Promise<AssistantStatus> {
    return firstValueFrom(this.http.get<AssistantStatus>('/api/assistant/status'));
  }

  ask(body: { text?: string; action?: AssistantAction; lang: string }): Promise<AssistantResult> {
    return firstValueFrom(this.http.post<AssistantResult>('/api/assistant/ask', body));
  }

  variant(body: {
    recipeId: string;
    kind: VariantKind;
    wish?: string;
    lang: string;
  }): Promise<VariantResult> {
    return firstValueFrom(this.http.post<VariantResult>('/api/assistant/variant', body));
  }

  applyPlan(
    meals: { date: string; slot: string; recipeId: string; leftover: boolean }[],
  ): Promise<{ added: number }> {
    return firstValueFrom(this.http.post<{ added: number }>('/api/assistant/plan/apply', { meals }));
  }

  /** Podyktowana / wklejona lista → pozycje do sprawdzenia */
  parseList(text: string): Promise<{ items: ParsedItem[] }> {
    return firstValueFrom(this.http.post<{ items: ParsedItem[] }>('/api/assistant/shopping/parse', { text }));
  }

  /** "Nie mam składnika" w trybie gotowania */
  substitute(body: { recipeId: string; lineId: string; lang: string }): Promise<Substitute> {
    return firstValueFrom(this.http.post<Substitute>('/api/assistant/substitute', body));
  }

  applyShopping(items: { ingredientId: string; grams: number }[]): Promise<{ added: number }> {
    return firstValueFrom(this.http.post<{ added: number }>('/api/assistant/shopping/apply', { items }));
  }
}
