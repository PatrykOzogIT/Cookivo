import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';
import { safeStorage } from '../storage';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'ck-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);

  readonly preference = signal<ThemePreference>(readPreference());

  constructor() {
    effect(() => {
      const pref = this.preference();
      const root = this.document.documentElement;
      if (pref === 'system') {
        delete root.dataset['theme'];
        safeStorage.remove(STORAGE_KEY);
      } else {
        root.dataset['theme'] = pref;
        safeStorage.set(STORAGE_KEY, pref);
      }
    });
  }

  /** Cykl: systemowy → jasny → ciemny → systemowy */
  cycle(): void {
    const order: ThemePreference[] = ['system', 'light', 'dark'];
    this.preference.update((p) => order[(order.indexOf(p) + 1) % order.length]);
  }
}

function readPreference(): ThemePreference {
  const stored = safeStorage.get(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}
