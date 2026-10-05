import { HttpClient, HttpEventType, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, filter, map, type Observable } from 'rxjs';
import type {
  Page,
  Photo,
  RatingItem,
  RatingSummary,
  RecipeDetail,
  RecipeQuery,
  RecipeSummary,
  SaveRecipe,
  VariantSummary,
} from './recipes.models';

export type UploadEvent = { type: 'progress'; percent: number } | { type: 'done'; photo: Photo };

@Injectable({ providedIn: 'root' })
export class RecipesApi {
  private readonly http = inject(HttpClient);

  list(query: RecipeQuery): Promise<Page<RecipeSummary>> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === '' || value === false || value === null) continue;
      if (Array.isArray(value)) {
        if (value.length) params = params.set(key, value.join(','));
      } else {
        params = params.set(key, String(value));
      }
    }
    return firstValueFrom(this.http.get<Page<RecipeSummary>>('/api/recipes', { params }));
  }

  get(id: string): Promise<RecipeDetail> {
    return firstValueFrom(this.http.get<RecipeDetail>(`/api/recipes/${id}`));
  }

  create(data: SaveRecipe): Promise<RecipeDetail> {
    return firstValueFrom(this.http.post<RecipeDetail>('/api/recipes', data));
  }

  update(id: string, data: SaveRecipe): Promise<RecipeDetail> {
    return firstValueFrom(this.http.patch<RecipeDetail>(`/api/recipes/${id}`, data));
  }

  /** "Zrób własną wersję" - prywatna kopia jako wariant */
  createVariant(id: string): Promise<RecipeDetail> {
    return firstValueFrom(this.http.post<RecipeDetail>(`/api/recipes/${id}/variant`, {}));
  }

  variants(id: string): Promise<{ originalId: string; items: VariantSummary[] }> {
    return firstValueFrom(
      this.http.get<{ originalId: string; items: VariantSummary[] }>(`/api/recipes/${id}/variants`),
    );
  }

  rate(id: string, stars: number, comment?: string): Promise<RatingSummary> {
    return firstValueFrom(this.http.put<RatingSummary>(`/api/recipes/${id}/rating`, { stars, comment }));
  }

  removeRating(id: string): Promise<RatingSummary> {
    return firstValueFrom(this.http.delete<RatingSummary>(`/api/recipes/${id}/rating`));
  }

  ratings(id: string, page = 1): Promise<Page<RatingItem>> {
    return firstValueFrom(
      this.http.get<Page<RatingItem>>(`/api/recipes/${id}/ratings`, { params: { page } }),
    );
  }

  remove(id: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`/api/recipes/${id}`));
  }

  hide(id: string, reason: string): Promise<RecipeDetail> {
    return firstValueFrom(this.http.post<RecipeDetail>(`/api/recipes/${id}/hide`, { reason }));
  }

  unhide(id: string): Promise<RecipeDetail> {
    return firstValueFrom(this.http.post<RecipeDetail>(`/api/recipes/${id}/unhide`, {}));
  }

  /** Wysyłka zdjęcia z postępem (pasek na słabym LTE) */
  uploadPhoto(file: Blob): Observable<UploadEvent> {
    const body = new FormData();
    body.append('file', file, 'photo.jpg');
    return this.http.post<Photo>('/api/photos', body, { reportProgress: true, observe: 'events' }).pipe(
      map((event): UploadEvent | null => {
        if (event.type === HttpEventType.UploadProgress) {
          return {
            type: 'progress',
            percent: event.total ? Math.round((100 * event.loaded) / event.total) : 0,
          };
        }
        if (event.type === HttpEventType.Response && event.body) return { type: 'done', photo: event.body };
        return null;
      }),
      filter((e): e is UploadEvent => e !== null),
    );
  }

  removePhoto(id: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`/api/photos/${id}`));
  }
}
