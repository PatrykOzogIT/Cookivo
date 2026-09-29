import { Component, input } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

/** Tymczasowa strona dla sekcji, które powstaną w kolejnych etapach. */
@Component({
  selector: 'app-placeholder-page',
  imports: [TranslocoDirective],
  template: `
    <section class="wrap" *transloco="let t">
      <div class="icon" aria-hidden="true">
        <span class="material-symbols-rounded">{{ icon() }}</span>
      </div>
      <h1>{{ t(titleKey()) }}</h1>
      <p>{{ t('placeholder.body', { stage: stage() }) }}</p>
    </section>
  `,
  styles: `
    .wrap {
      max-width: 560px;
      margin: 0 auto;
      padding: 64px var(--ck-gutter) 0;
      text-align: center;
    }
    .icon {
      display: inline-grid;
      place-items: center;
      width: 88px;
      height: 88px;
      margin-bottom: 20px;
      border-radius: 28px;
      background: var(--ck-hero);
      border: 1px solid var(--ck-border);
      color: var(--ck-link);
      .material-symbols-rounded {
        font-size: 44px;
      }
    }
    p {
      color: var(--ck-text-muted);
    }
  `,
})
export class PlaceholderPage {
  // Wartości z `data` trasy (withComponentInputBinding)
  readonly titleKey = input('');
  readonly icon = input('construction');
  readonly stage = input(0);
}
