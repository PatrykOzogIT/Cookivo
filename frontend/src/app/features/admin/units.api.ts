import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Localized } from '../ingredients/ingredients.models';

export interface UnitSuggestion {
  id: string;
  ingredient: Localized & { id: string };
  unit: Localized & { code: string };
  grams: number;
  /** Waga w bazie (np. szacunek AI), jeśli już jest */
  current: number | null;
  username: string | null;
  createdAt: string;
}

export interface UnitEstimateRow {
  ingredient: Localized & { id: string };
  unit: Localized & { code: string };
  grams: number;
}

/** Panel admina: wagi miar kuchennych - propozycje użytkowników i szacunki AI */
@Injectable({ providedIn: 'root' })
export class AdminUnitsApi {
  private readonly http = inject(HttpClient);

  suggestions(): Promise<UnitSuggestion[]> {
    return firstValueFrom(this.http.get<UnitSuggestion[]>('/api/admin/units/suggestions'));
  }

  estimates(
    q: string,
    page: number,
  ): Promise<{ total: number; page: number; pageSize: number; items: UnitEstimateRow[] }> {
    return firstValueFrom(
      this.http.get<{ total: number; page: number; pageSize: number; items: UnitEstimateRow[] }>(
        '/api/admin/units/estimates',
        { params: { page, ...(q ? { q } : {}) } },
      ),
    );
  }

  approve(id: string, grams: number): Promise<void> {
    return firstValueFrom(this.http.post<void>(`/api/admin/units/suggestions/${id}/approve`, { grams }));
  }

  reject(id: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(`/api/admin/units/suggestions/${id}/reject`, {}));
  }

  set(ingredientId: string, unitCode: string, grams: number): Promise<void> {
    return firstValueFrom(this.http.put<void>(`/api/admin/units/${ingredientId}/${unitCode}`, { grams }));
  }
}
