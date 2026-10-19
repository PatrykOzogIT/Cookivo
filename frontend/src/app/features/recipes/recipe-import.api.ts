import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { LineItem } from './recipe-units';

export interface ImportStatus {
  enabled: boolean;
  dailyLimit: number;
  remaining: number;
  maxPhotos: number;
}

/** Składnik z bazy w kształcie pozycji formularza */
type DraftItem = Pick<LineItem, 'id' | 'density' | 'units'> & { namePl: string; nameEn: string | null };

export interface DraftLine {
  /** Linia tak, jak na zdjęciu */
  text: string;
  name: string;
  amount: number | null;
  unitCode: string | null;
  note: string | null;
  match: DraftItem | null;
  suggestions: DraftItem[];
  uncertain: boolean;
  unitProblem: boolean;
}

export interface RecipeDraft {
  title: string;
  description: string | null;
  servings: number | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  ingredients: DraftLine[];
  steps: string[];
  warnings: string[];
}

export function toLineItem(i: DraftItem): LineItem {
  return {
    kind: 'ingredient',
    id: i.id,
    name: { namePl: i.namePl, nameEn: i.nameEn },
    density: i.density,
    units: i.units,
  };
}

/** Import przepisu ze zdjęć (odczyt przez model językowy po stronie serwera) */
@Injectable({ providedIn: 'root' })
export class RecipeImportApi {
  private readonly http = inject(HttpClient);

  status(): Promise<ImportStatus> {
    return firstValueFrom(this.http.get<ImportStatus>('/api/recipe-import/status'));
  }

  import(photos: Blob[], lang: string): Promise<RecipeDraft> {
    const body = new FormData();
    photos.forEach((p, i) => body.append('photos', p, `photo-${i + 1}.jpg`));
    body.append('lang', lang);
    return firstValueFrom(this.http.post<RecipeDraft>('/api/recipe-import', body));
  }
}
