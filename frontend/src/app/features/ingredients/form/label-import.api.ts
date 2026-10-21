import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { IngredientStatus } from '../ingredients.models';

export interface LabelStatus {
  enabled: boolean;
  dailyLimit: number;
  remaining: number;
  maxPhotos: number;
}

export type LabelNutrient =
  'kcal' | 'protein' | 'fat' | 'saturatedFat' | 'carbs' | 'sugars' | 'fiber' | 'salt';

export interface SimilarIngredient {
  id: string;
  namePl: string;
  nameEn: string | null;
  status: IngredientStatus;
}

/** Szkic z etykiety - wartości na 100 g, null = nie odczytano (do uzupełnienia) */
export interface LabelDraft {
  namePl: string | null;
  nameEn: string | null;
  printedName: string | null;
  category: string | null;
  values: Record<LabelNutrient, number | null>;
  perMl: boolean;
  fromPortion: boolean;
  missing: LabelNutrient[];
  portionUnknown: boolean;
  problem: string | null;
  noTable: boolean;
  liquid: boolean;
  ingredientsVisible: boolean;
  allergens: string[];
  mayContain: string[];
  packageGrams: number | null;
  warnings: string[];
  similar: SimilarIngredient[];
}

/** Odczyt etykiety produktu ze zdjęć (formularz składnika) */
@Injectable({ providedIn: 'root' })
export class LabelImportApi {
  private readonly http = inject(HttpClient);

  status(): Promise<LabelStatus> {
    return firstValueFrom(this.http.get<LabelStatus>('/api/label-import/status'));
  }

  analyze(photos: Blob[], lang: string, name: string): Promise<LabelDraft> {
    const body = new FormData();
    photos.forEach((p, i) => body.append('photos', p, `label-${i + 1}.jpg`));
    body.append('lang', lang);
    if (name) body.append('name', name);
    return firstValueFrom(this.http.post<LabelDraft>('/api/label-import', body));
  }

  similar(namePl: string, nameEn: string): Promise<SimilarIngredient[]> {
    return firstValueFrom(
      this.http.get<SimilarIngredient[]>('/api/ingredients/similar', {
        params: nameEn ? { namePl, nameEn } : { namePl },
      }),
    );
  }
}
