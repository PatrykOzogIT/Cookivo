import { Injectable, computed, signal } from '@angular/core';
import { releasePhotos, type PickedPhoto } from '../../shared/photo-picker';
import type { Currency } from '../prices/prices.api';
import type { ReceiptCommitResult, ReceiptDraft } from './receipt-import.api';
import type { EditLine } from './receipt-lines';

/** "NEW" = nowy cennik zakładany przy zatwierdzeniu */
export type ListChoice = string | 'NEW' | null;

/**
 * Stan importu paragonu - w serwisie, żeby powrót do poprzedniego kroku albo wyjście
 * na chwilę z ekranu (np. do cenników) nie gubiły zdjęć, odczytu ani poprawek.
 */
@Injectable({ providedIn: 'root' })
export class ReceiptImportStore {
  readonly photos = signal<PickedPhoto[]>([]);
  /** Cele importu - oba domyślnie zaznaczone */
  readonly toPantry = signal(true);
  readonly toPrices = signal(true);

  readonly draft = signal<ReceiptDraft | null>(null);
  readonly lines = signal<EditLine[]>([]);
  readonly store = signal('');
  readonly purchasedOn = signal('');
  readonly currency = signal<Currency>('PLN');
  /** Gospodarstwo z chwili odczytu - zapis musi trafić tam samo */
  readonly householdId = signal<string | null>(null);

  readonly listChoice = signal<ListChoice>(null);
  /** Dane nowego cennika zatwierdzone w formularzu (cennik powstaje dopiero przy zatwierdzeniu importu) */
  readonly newList = signal<{ name: string; currency: Currency } | null>(null);

  readonly result = signal<ReceiptCommitResult | null>(null);

  readonly step = computed<'photos' | 'review' | 'done'>(() =>
    this.result() ? 'done' : this.draft() ? 'review' : 'photos',
  );

  patchLine(key: number, patch: Partial<EditLine>): void {
    this.lines.update((list) => list.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  removeLine(key: number): void {
    this.lines.update((list) => list.filter((l) => l.key !== key));
  }

  /** Nowy import od zera (cele wracają do domyślnych) */
  reset(): void {
    releasePhotos(this.photos());
    this.photos.set([]);
    this.toPantry.set(true);
    this.toPrices.set(true);
    this.draft.set(null);
    this.lines.set([]);
    this.store.set('');
    this.purchasedOn.set('');
    this.currency.set('PLN');
    this.householdId.set(null);
    this.listChoice.set(null);
    this.newList.set(null);
    this.result.set(null);
  }
}
