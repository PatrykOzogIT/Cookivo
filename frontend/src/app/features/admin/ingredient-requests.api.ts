import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Localized } from '../ingredients/ingredients.models';

export type IngredientRequestStatus = 'OPEN' | 'DONE' | 'REJECTED';

export interface IngredientRequest {
  id: string;
  /** Pełna nazwa od użytkownika */
  name: string;
  receiptText: string | null;
  storeName: string | null;
  status: IngredientRequestStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AdminIngredientRequest extends IngredientRequest {
  user: string;
  ingredient: (Localized & { id: string }) | null;
}

/** Prośby o dodanie składnika: zgłoszenie (np. z importu paragonu) i kolejka admina */
@Injectable({ providedIn: 'root' })
export class IngredientRequestsApi {
  private readonly http = inject(HttpClient);

  create(body: { name: string; importId?: string; key?: number }): Promise<IngredientRequest> {
    return firstValueFrom(this.http.post<IngredientRequest>('/api/ingredient-requests', body));
  }

  async list(status: IngredientRequestStatus): Promise<AdminIngredientRequest[]> {
    const res = await firstValueFrom(
      this.http.get<{ items: AdminIngredientRequest[] }>('/api/admin/ingredient-requests', {
        params: { status },
      }),
    );
    return res.items;
  }

  resolve(id: string, ingredientId: string): Promise<{ resolved: number }> {
    return firstValueFrom(
      this.http.post<{ resolved: number }>(`/api/admin/ingredient-requests/${id}/resolve`, { ingredientId }),
    );
  }

  reject(id: string): Promise<{ rejected: number }> {
    return firstValueFrom(
      this.http.post<{ rejected: number }>(`/api/admin/ingredient-requests/${id}/reject`, {}),
    );
  }
}
