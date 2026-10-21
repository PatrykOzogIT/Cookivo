import { Injectable, signal } from '@angular/core';
import type { AssistantResult, AssistantStatus, PrepResult, VariantResult } from './assistant.api';

export type NewEntry =
  | { kind: 'user'; text: string }
  | { kind: 'result'; result: AssistantResult }
  | { kind: 'error'; code: string };
export type Entry = NewEntry & { id: number };

/**
 * Stan asystenta w pamięci przeglądarki (rozmowy nie zapisujemy na serwerze):
 * otwarty panel, historia bieżącej sesji, kontekst przepisu dla "Zrób z tego wersję…".
 */
@Injectable({ providedIn: 'root' })
export class AssistantStore {
  readonly open = signal(false);
  /** null = wyłączony albo jeszcze nie wiadomo (przycisk przy przepisie się wtedy nie pokazuje) */
  readonly status = signal<AssistantStatus | null>(null);
  readonly entries = signal<Entry[]>([]);
  /** Przepis, z którego robimy wersję (otwiera panel w trybie wersji) */
  readonly variantOf = signal<{ id: string; title: string } | null>(null);
  /** Gotowa wersja czekająca na formularz przepisu */
  readonly variantDraft = signal<(VariantResult & { originalTitle: string }) | null>(null);
  /** Ostatni harmonogram gotowania (przeżywa wyjście z ekranu, nie odświeżenie strony) */
  readonly prep = signal<{ result: PrepResult; start: string; done: ReadonlySet<string> } | null>(null);
  private nextId = 1;

  add(entry: NewEntry): void {
    this.entries.update((list) => [...list, { ...entry, id: this.nextId++ }].slice(-20));
  }

  openFor(recipe: { id: string; title: string } | null): void {
    this.variantOf.set(recipe);
    this.open.set(true);
  }
}
