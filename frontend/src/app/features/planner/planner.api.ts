import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Targets } from '../profile/nutrition-calculator';
import type { Photo } from '../recipes/recipes.models';

export const STANDARD_SLOTS = [
  'BREAKFAST',
  'SECOND_BREAKFAST',
  'DINNER',
  'AFTERNOON_SNACK',
  'SUPPER',
  'SNACK',
] as const;
export type StandardSlot = (typeof STANDARD_SLOTS)[number];

/** Podpowiedź filtra przepisów dla posiłku (II śniadanie ≈ przepisy oznaczone jako lunch) */
export const SLOT_MEAL_TYPE: Record<StandardSlot, string> = {
  BREAKFAST: 'BREAKFAST',
  SECOND_BREAKFAST: 'LUNCH',
  DINNER: 'DINNER',
  AFTERNOON_SNACK: 'AFTERNOON_SNACK',
  SUPPER: 'SUPPER',
  SNACK: 'SNACK',
};

export interface Macros {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface PlanRecipe {
  id: string;
  title: string;
  servings: number;
  perServing: Macros;
  cover: Photo | null;
  allergens: string[];
  myAllergens: string[];
}

export interface PlanSlot {
  /** Kod stałego posiłku albo id własnego */
  key: string;
  code: StandardSlot | null;
  name: string | null;
  hidden: boolean;
}

/** Osoba w trybie dokładnym ('u:<id>' z kontem, 'd:<id>' bez konta) */
export interface PlanPerson {
  key: string;
  kind: 'MEMBER' | 'DEPENDENT';
  isMe: boolean;
  name: string;
  /** Cel kcal używany do podziału */
  kcal: number;
  /** PROFILE - z profilu, REFERENCE - wartość dla wieku, CUSTOM - wpisana, DEFAULT - neutralna (brak zgody/profilu) */
  source: 'PROFILE' | 'REFERENCE' | 'CUSTOM' | 'DEFAULT';
}

export interface PlanShare {
  key: string;
  fraction: number;
  servings: number;
  grams: number | null;
  kcal: number;
}

export type GramsSource = 'WEIGHED' | 'RECIPE' | 'ESTIMATE';

export interface PlanMeal {
  id: string;
  date: string;
  slot: string;
  servings: number;
  myServings: number;
  /** Tryb dokładny: kto nie je, podział i waga tego posiłku */
  absent: string[];
  shares: PlanShare[] | null;
  grams: number | null;
  cook: {
    id: string;
    date: string;
    servings: number;
    remaining: number;
    mealsCount: number;
    potGrams: number | null;
    gramsSource: GramsSource | null;
  };
  fromLeftovers: boolean;
  daysAfterCooking: number;
  stale: boolean;
  recipe: PlanRecipe;
}

export interface Leftover {
  cookId: string;
  date: string;
  servings: number;
  remaining: number;
  recipe: PlanRecipe;
}

export interface PlannerSettings {
  hiddenSlots: StandardSlot[];
  exactPortions: boolean;
}

export interface PlanWeek {
  scope: 'USER' | 'HOUSEHOLD';
  people: number;
  freshDays: number;
  settings: PlannerSettings;
  slots: PlanSlot[];
  targets: Targets | null;
  persons: PlanPerson[];
  /** Koszt gotowań w tygodniu wg domyślnego cennika (null = brak cennika) */
  cost: { currency: string; cents: number; missing: number } | null;
  meals: PlanMeal[];
  leftovers: Leftover[];
}

export interface AddMeal {
  date: string;
  slot: string;
  recipeId?: string;
  cookId?: string;
  servings: number;
  cookServings?: number;
}

@Injectable({ providedIn: 'root' })
export class PlannerApi {
  private readonly http = inject(HttpClient);

  get(from: string, to: string): Promise<PlanWeek> {
    return firstValueFrom(this.http.get<PlanWeek>('/api/planner', { params: { from, to } }));
  }

  addMeal(body: AddMeal): Promise<{ id: string }> {
    return firstValueFrom(this.http.post<{ id: string }>('/api/planner/meals', body));
  }

  updateMeal(id: string, body: { date?: string; slot?: string; servings?: number }): Promise<unknown> {
    return firstValueFrom(this.http.patch(`/api/planner/meals/${id}`, body));
  }

  deleteMeal(id: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`/api/planner/meals/${id}`));
  }

  updateCook(id: string, servings: number): Promise<unknown> {
    return firstValueFrom(this.http.patch(`/api/planner/cooks/${id}`, { servings }));
  }

  setEaters(mealId: string, absent: string[]): Promise<unknown> {
    return firstValueFrom(this.http.put(`/api/planner/meals/${mealId}/eaters`, { absent }));
  }

  setCookWeight(cookId: string, cookedGrams: number | null): Promise<unknown> {
    return firstValueFrom(this.http.put(`/api/planner/cooks/${cookId}/weight`, { cookedGrams }));
  }

  deleteCook(id: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`/api/planner/cooks/${id}`));
  }

  copy(from: string, to: string, days: 1 | 7): Promise<{ copied: number }> {
    return firstValueFrom(this.http.post<{ copied: number }>('/api/planner/copy', { from, to, days }));
  }

  clear(from: string, to: string): Promise<unknown> {
    return firstValueFrom(this.http.delete('/api/planner', { params: { from, to } }));
  }

  saveSettings(settings: PlannerSettings): Promise<PlannerSettings> {
    return firstValueFrom(this.http.put<PlannerSettings>('/api/planner/settings', settings));
  }

  addSlot(name: string): Promise<PlanSlot> {
    return firstValueFrom(this.http.post<PlanSlot>('/api/planner/slots', { name }));
  }

  renameSlot(id: string, name: string): Promise<unknown> {
    return firstValueFrom(this.http.patch(`/api/planner/slots/${id}`, { name }));
  }

  deleteSlot(id: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`/api/planner/slots/${id}`));
  }
}
