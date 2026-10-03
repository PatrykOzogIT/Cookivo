import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Localized } from '../ingredients/ingredients.models';

export const CURRENCIES = ['PLN', 'EUR', 'GBP', 'USD', 'CZK'] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface PriceList {
  id: string;
  name: string;
  currency: Currency;
  isDefault: boolean;
  entries: number;
}

export interface PriceEntry {
  id: string;
  ingredient: Localized & { id: string; category: { code: string; icon: string } };
  packageAmount: number;
  packageUnitCode: string;
  priceCents: number;
  /** Cena do porównań: za kg, l albo sztukę */
  unitPrice: { cents: number; per: 'kg' | 'l' | 'PIECE' };
  updatedAt: string;
}

export interface PriceEntries {
  list: Omit<PriceList, 'entries'>;
  entries: PriceEntry[];
}

export interface SavePriceEntry {
  ingredientId: string;
  packageAmount: number;
  packageUnitCode: string;
  price: number;
}

/** Szacowany koszt (null = brak cennika) */
export interface Cost {
  currency: Currency;
  listName: string;
  cents: number;
  priced: number;
  missing: (Localized & { id: string })[];
  perServingCents: number;
}

@Injectable({ providedIn: 'root' })
export class PricesApi {
  private readonly http = inject(HttpClient);

  async lists(): Promise<PriceList[]> {
    return (await firstValueFrom(this.http.get<{ lists: PriceList[] }>('/api/prices'))).lists;
  }

  async create(name: string, currency: Currency): Promise<PriceList[]> {
    return (await firstValueFrom(this.http.post<{ lists: PriceList[] }>('/api/prices', { name, currency })))
      .lists;
  }

  async update(
    id: string,
    body: { name?: string; currency?: Currency; isDefault?: boolean },
  ): Promise<PriceList[]> {
    return (await firstValueFrom(this.http.patch<{ lists: PriceList[] }>(`/api/prices/${id}`, body))).lists;
  }

  async remove(id: string): Promise<PriceList[]> {
    return (await firstValueFrom(this.http.delete<{ lists: PriceList[] }>(`/api/prices/${id}`))).lists;
  }

  entries(id: string): Promise<PriceEntries> {
    return firstValueFrom(this.http.get<PriceEntries>(`/api/prices/${id}/entries`));
  }

  setEntry(id: string, body: SavePriceEntry): Promise<PriceEntries> {
    return firstValueFrom(this.http.put<PriceEntries>(`/api/prices/${id}/entries`, body));
  }

  removeEntry(id: string, entryId: string): Promise<PriceEntries> {
    return firstValueFrom(this.http.delete<PriceEntries>(`/api/prices/${id}/entries/${entryId}`));
  }

  async recipeCost(recipeId: string, servings: number): Promise<Cost | null> {
    return (
      await firstValueFrom(
        this.http.get<{ cost: Cost | null }>(`/api/recipes/${recipeId}/cost`, { params: { servings } }),
      )
    ).cost;
  }
}

/** Kwota w walucie i języku, np. "12,99 zł" / "€4.29" */
export function formatMoney(cents: number, currency: string, lang: string): string {
  return new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'pl-PL', { style: 'currency', currency }).format(
    cents / 100,
  );
}
