import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';
import { safeStorage } from '../storage';

/** Motyw wizualny; `auto` = wg ustawień systemu (ciemny → midnight, zwiększony kontrast → contrast) */
export type ThemePreference = 'auto' | 'fresh' | 'citrus' | 'midnight' | 'contrast';

export const THEMES: readonly ThemePreference[] = ['auto', 'fresh', 'citrus', 'midnight', 'contrast'];

const STORAGE_KEY = 'ck-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);

  readonly preference = signal<ThemePreference>(readPreference());

  constructor() {
    effect(() => {
      const pref = this.preference();
      const root = this.document.documentElement;
      if (pref === 'auto') {
        delete root.dataset['theme'];
        safeStorage.remove(STORAGE_KEY);
      } else {
        root.dataset['theme'] = pref;
        safeStorage.set(STORAGE_KEY, pref);
      }
    });
  }

  set(pref: ThemePreference): void {
    this.preference.set(pref);
  }
}

/** Zapisany wybór; dawne "light"/"dark" przechodzą na Fresh & Tasty / Midnight Mango */
export function readPreference(): ThemePreference {
  const stored = safeStorage.get(STORAGE_KEY);
  if (stored === 'light') return 'fresh';
  if (stored === 'dark') return 'midnight';
  return THEMES.includes(stored as ThemePreference) ? (stored as ThemePreference) : 'auto';
}
