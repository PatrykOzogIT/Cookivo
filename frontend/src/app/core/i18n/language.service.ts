import { DOCUMENT, Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { safeStorage } from '../storage';

export const LANGUAGES = ['pl', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

const STORAGE_KEY = 'ck-lang';

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly transloco = inject(TranslocoService);
  private readonly document = inject(DOCUMENT);

  readonly current = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });

  /** Kolejność: zapisany wybór → język przeglądarki → polski. */
  initialLanguage(): Language {
    const stored = safeStorage.get(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
    const browser = this.document.defaultView?.navigator.language?.slice(0, 2);
    return isLanguage(browser) ? browser : 'pl';
  }

  use(lang: Language): void {
    this.transloco.setActiveLang(lang);
    this.document.documentElement.lang = lang;
    safeStorage.set(STORAGE_KEY, lang);
  }

  toggle(): void {
    this.use(this.current() === 'pl' ? 'en' : 'pl');
  }
}

function isLanguage(value: unknown): value is Language {
  return LANGUAGES.includes(value as Language);
}
