import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Localized } from '../ingredients/ingredients.models';
import type { Currency } from '../prices/prices.api';

export interface ReceiptStatus {
  enabled: boolean;
  dailyLimit: number;
  remaining: number;
  maxPhotos: number;
}

/** Składnik z bazy w podglądzie (jednostki do wyboru opakowania) */
export interface ReceiptIngredient extends Localized {
  id: string;
  density: number | null;
  units: (Localized & { code: string; grams: number })[];
  category: { icon: string };
}

export type MatchStatus = 'MATCHED' | 'CONFIRM' | 'NOT_FOUND';
/** Skąd dopasowanie: własne powiązanie / wybór innych / AI z listy / podobna nazwa */
export type MatchSource = 'MINE' | 'COMMUNITY' | 'AI' | 'NAME';

export interface ReceiptDraftLine {
  key: number;
  /** Linia z paragonu tak, jak wydrukowana */
  text: string;
  name: string;
  status: MatchStatus;
  matchSource: MatchSource | null;
  /** Przy CONFIRM może być już wybrany (do potwierdzenia) */
  ingredient: ReceiptIngredient | null;
  suggestions: ReceiptIngredient[];
  packages: number;
  packageAmount: number | null;
  packageUnitCode: string | null;
  /** Cena regularna opakowania */
  priceCents: number | null;
  lineTotalCents: number | null;
  uncertain: boolean;
  /** Kody: PRICE_MISMATCH, NO_PRICE, NO_PACKAGE_SIZE, UNIT_NOT_ALLOWED */
  warnings: string[];
}

export interface ReceiptDraft {
  importId: string;
  store: string | null;
  purchasedOn: string | null;
  /** null = nie odczytano albo nieobsługiwana waluta */
  currency: Currency | null;
  currencyRead: string | null;
  suggestedListId: string | null;
  lines: ReceiptDraftLine[];
  totalCents: number;
  skipped: number;
  warnings: string[];
}

export interface ReceiptCommitLine {
  /** Numer pozycji ze szkicu - zapamiętujemy powiązanie tekst z paragonu → składnik */
  key: number;
  ingredientId: string;
  toPantry: boolean;
  toPrices: boolean;
  packages: number;
  packageAmount: number;
  packageUnitCode: string;
  price: number | null;
}

export interface ReceiptCommit {
  toPantry: boolean;
  toPrices: boolean;
  listId?: string;
  newList?: { name: string; currency: Currency };
  store?: string;
  purchasedOn?: string;
  currency: Currency;
  lines: ReceiptCommitLine[];
}

export interface ReceiptCommitResult {
  pantry: number;
  prices: number;
  list: { id: string; name: string; created: boolean } | null;
}

/** Import paragonu ze zdjęć: odczyt przez AI → szkic → zatwierdzenie (lodówka, cennik) */
@Injectable({ providedIn: 'root' })
export class ReceiptImportApi {
  private readonly http = inject(HttpClient);

  status(): Promise<ReceiptStatus> {
    return firstValueFrom(this.http.get<ReceiptStatus>('/api/receipt-import/status'));
  }

  analyze(photos: Blob[], lang: string): Promise<ReceiptDraft> {
    const body = new FormData();
    photos.forEach((p, i) => body.append('photos', p, `receipt-${i + 1}.jpg`));
    body.append('lang', lang);
    return firstValueFrom(this.http.post<ReceiptDraft>('/api/receipt-import', body));
  }

  commit(importId: string, body: ReceiptCommit): Promise<ReceiptCommitResult> {
    return firstValueFrom(
      this.http.post<ReceiptCommitResult>(`/api/receipt-import/${importId}/commit`, body),
    );
  }
}
