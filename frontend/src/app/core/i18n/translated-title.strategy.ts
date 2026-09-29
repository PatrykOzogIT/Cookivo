import { DOCUMENT, Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { type RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';

/**
 * Tytuł karty z klucza tłumaczenia (`data.titleKey`), odświeżany przy zmianie języka.
 * Po nawigacji przenosi fokus na <main>, żeby czytnik ekranu ogłosił nową stronę (WCAG 2.4.3).
 */
@Injectable({ providedIn: 'root' })
export class TranslatedTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly transloco = inject(TranslocoService);
  private readonly document = inject(DOCUMENT);
  private lastKey: string | undefined;
  private firstNavigation = true;

  constructor() {
    super();
    this.transloco.langChanges$.subscribe(() => this.apply());
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    let route = snapshot.root;
    while (route.firstChild) route = route.firstChild;
    this.lastKey = route.data['titleKey'] as string | undefined;
    this.apply();

    if (this.firstNavigation) {
      this.firstNavigation = false;
    } else {
      this.document.getElementById('main')?.focus({ preventScroll: true });
    }
  }

  private apply(): void {
    const key = this.lastKey;
    this.title.setTitle(key ? `${this.transloco.translate(key)} · Cookivo` : 'Cookivo');
  }
}
