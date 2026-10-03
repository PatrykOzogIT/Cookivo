import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Localized } from '../ingredients/ingredients.models';

export type ShoppingUnit = 'PIECE' | 'g' | 'kg' | 'ml' | 'l';

export interface ShoppingAmount {
  amount: number;
  unit: ShoppingUnit;
  grams: number;
}

export interface ShoppingItem {
  id: string;
  ingredient:
    | (Localized & { id: string; category: Localized & { code: string; icon: string; sortOrder: number } })
    | null;
  name: string | null;
  note: string | null;
  grams: number | null;
  amount: ShoppingAmount | null;
  checked: boolean;
  checkedBy: string | null;
  /** Koszt pozycji wg domyślnego cennika (null = brak ceny) */
  costCents: number | null;
  updatedAt: string;
}

export interface ShoppingCost {
  currency: string;
  listName: string;
  cents: number;
  priced: number;
  missing: number;
}

export interface AddResult {
  added: number;
  /** Pominięte, bo są w lodówce */
  inPantry: (Localized & { id: string })[];
}

export interface AddItem {
  ingredientId?: string;
  amount?: number;
  unitCode?: string;
  name?: string;
  note?: string;
}

@Injectable({ providedIn: 'root' })
export class ShoppingApi {
  private readonly http = inject(HttpClient);

  list(): Promise<{ items: ShoppingItem[]; cost: ShoppingCost | null }> {
    return firstValueFrom(
      this.http.get<{ items: ShoppingItem[]; cost: ShoppingCost | null }>('/api/shopping'),
    );
  }

  fromPlan(from: string, to: string): Promise<AddResult> {
    return firstValueFrom(this.http.post<AddResult>('/api/shopping/from-plan', { from, to }));
  }

  fromRecipe(recipeId: string, servings: number): Promise<AddResult> {
    return firstValueFrom(this.http.post<AddResult>('/api/shopping/from-recipe', { recipeId, servings }));
  }

  add(body: AddItem): Promise<ShoppingItem> {
    return firstValueFrom(this.http.post<ShoppingItem>('/api/shopping/items', body));
  }

  update(id: string, body: { checked?: boolean; note?: string }): Promise<ShoppingItem> {
    return firstValueFrom(this.http.patch<ShoppingItem>(`/api/shopping/items/${id}`, body));
  }

  remove(id: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`/api/shopping/items/${id}`));
  }

  clear(checkedOnly: boolean): Promise<unknown> {
    return firstValueFrom(this.http.post('/api/shopping/clear', { checkedOnly }));
  }

  toPantry(): Promise<{ moved: number }> {
    return firstValueFrom(this.http.post<{ moved: number }>('/api/shopping/to-pantry', {}));
  }
}
