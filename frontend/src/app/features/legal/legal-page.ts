import { Component, computed, input } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * Regulamin i polityka prywatności.
 * UWAGA: to robocze streszczenie - ostateczną treść musi przygotować lub
 * zweryfikować prawnik przed publicznym uruchomieniem serwisu.
 */
@Component({
  selector: 'app-legal-page',
  imports: [TranslocoDirective],
  template: `
    <article class="wrap" *transloco="let t; prefix: 'legal.' + docKey()">
      <h1>{{ t('title') }}</h1>
      <p class="draft" role="note">
        <span class="material-symbols-rounded" aria-hidden="true">info</span>
        {{ t('draft') }}
      </p>
      @for (i of sections; track i) {
        <section>
          <h2>{{ t('s' + i + '.title') }}</h2>
          <p>{{ t('s' + i + '.body') }}</p>
        </section>
      }
    </article>
  `,
  styles: `
    .wrap {
      max-width: 760px;
      margin: 0 auto;
      padding: 40px var(--ck-gutter) 0;
    }
    h2 {
      font-size: 1.15rem;
      margin-top: 28px;
    }
    .draft {
      display: flex;
      gap: 10px;
      padding: 12px 14px;
      border-radius: var(--ck-radius-sm);
      background: var(--ck-surface-2);
      border: 1px solid var(--ck-border);
      font-size: 0.925rem;
    }
  `,
})
export class LegalPage {
  /** Parametr trasy :doc */
  readonly doc = input<string>('privacy');
  protected readonly docKey = computed(() => (this.doc() === 'terms' ? 'termsDoc' : 'privacyDoc'));
  protected readonly sections = [1, 2, 3, 4, 5];
}
