import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, shareReplay, type Observable } from 'rxjs';
import type { Dictionaries, Ingredient, IngredientQuery, Page, SaveIngredient } from './ingredients.models';

@Injectable({ providedIn: 'root' })
export class IngredientsApi {
  private readonly http = inject(HttpClient);

  /** Słowniki zmieniają się rzadko - pobieramy raz na sesję */
  readonly dictionaries$: Observable<Dictionaries> = this.http
    .get<Dictionaries>('/api/dictionaries')
    .pipe(shareReplay({ bufferSize: 1, refCount: false }));

  list(query: IngredientQuery): Promise<Page<Ingredient>> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === '' || value === false) continue;
      if (Array.isArray(value)) {
        if (value.length) params = params.set(key, value.join(','));
      } else {
        params = params.set(key, String(value));
      }
    }
    return firstValueFrom(this.http.get<Page<Ingredient>>('/api/ingredients', { params }));
  }

  get(id: string): Promise<Ingredient> {
    return firstValueFrom(this.http.get<Ingredient>(`/api/ingredients/${id}`));
  }

  create(data: SaveIngredient): Promise<Ingredient> {
    return firstValueFrom(this.http.post<Ingredient>('/api/ingredients', data));
  }

  update(id: string, data: SaveIngredient): Promise<Ingredient> {
    return firstValueFrom(this.http.patch<Ingredient>(`/api/ingredients/${id}`, data));
  }

  remove(id: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`/api/ingredients/${id}`));
  }

  approve(id: string): Promise<Ingredient> {
    return firstValueFrom(this.http.post<Ingredient>(`/api/ingredients/${id}/approve`, {}));
  }

  reject(id: string, reason: string): Promise<Ingredient> {
    return firstValueFrom(this.http.post<Ingredient>(`/api/ingredients/${id}/reject`, { reason }));
  }
}
