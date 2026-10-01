import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Localized } from '../ingredients/ingredients.models';

export interface PantryIngredient extends Localized {
  id: string;
  density: number | null;
  category: Localized & { code: string; icon: string };
  units: (Localized & { code: string; grams: number })[];
}

export interface PantryItem {
  id: string;
  ingredient: PantryIngredient;
  /** Ilość opcjonalna: null = "mam" */
  amount: number | null;
  unitCode: string | null;
  grams: number | null;
  expiresOn: string | null;
  daysLeft: number | null;
  expiring: boolean;
}

export interface SavePantryItem {
  ingredientId: string;
  amount?: number | null;
  unitCode?: string | null;
  expiresOn?: string | null;
}

@Injectable({ providedIn: 'root' })
export class PantryApi {
  private readonly http = inject(HttpClient);

  async list(): Promise<PantryItem[]> {
    return (await firstValueFrom(this.http.get<{ items: PantryItem[] }>('/api/pantry'))).items;
  }

  upsert(body: SavePantryItem): Promise<PantryItem> {
    return firstValueFrom(this.http.post<PantryItem>('/api/pantry', body));
  }

  update(id: string, body: Omit<SavePantryItem, 'ingredientId'>): Promise<PantryItem> {
    return firstValueFrom(this.http.patch<PantryItem>(`/api/pantry/${id}`, body));
  }

  remove(id: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`/api/pantry/${id}`));
  }
}
