import { Component, computed, input } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

/** Gwiazdki do odczytu, np. średnia 4,3 z 12 ocen. Dla czytnika: jeden opis zamiast 5 ikon. */
@Component({
  selector: 'app-stars',
  imports: [TranslocoDirective],
  template: `
    <span
      class="stars"
      role="img"
      *transloco="let t"
      [attr.aria-label]="
        count() === null
          ? t('ratings.ariaOne', { value: label() })
          : t('ratings.aria', { value: label(), count: count() })
      "
    >
      @for (s of icons(); track $index) {
        <span class="material-symbols-rounded" [class.filled]="s !== 'star_border'" aria-hidden="true">{{
          s === 'star_border' ? 'star' : s
        }}</span>
      }
      @if (showValue()) {
        <span class="value" aria-hidden="true">{{ label() }}</span>
        @if (count() !== null) {
          <span class="count" aria-hidden="true">({{ count() }})</span>
        }
      }
    </span>
  `,
  styles: `
    .stars {
      display: inline-flex;
      align-items: center;
      gap: 1px;
      white-space: nowrap;
    }
    .material-symbols-rounded {
      font-size: 1.1em;
      color: var(--ck-text-muted);
    }
    .filled {
      color: var(--ck-accent-to);
      font-variation-settings: 'FILL' 1;
    }
    .value {
      margin-left: 4px;
      font-weight: 700;
    }
    .count {
      margin-left: 2px;
      color: var(--ck-text-muted);
    }
  `,
})
export class StarsComponent {
  readonly value = input.required<number>();
  readonly count = input<number | null>(null);
  readonly lang = input('pl');
  readonly showValue = input(true);

  protected readonly icons = computed(() => {
    const v = this.value();
    return [1, 2, 3, 4, 5].map((i) => (v >= i - 0.25 ? 'star' : v >= i - 0.75 ? 'star_half' : 'star_border'));
  });
  protected readonly label = computed(() =>
    new Intl.NumberFormat(this.lang() === 'en' ? 'en-GB' : 'pl-PL', { maximumFractionDigits: 1 }).format(
      this.value(),
    ),
  );
}
