import { Component, computed, inject, input } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { NumberPipe } from '../../core/i18n/format.pipes';
import { LanguageService } from '../../core/i18n/language.service';
import type { Targets } from './nutrition-calculator';

/** Wynik kalkulatora: kalorie, makro (g i % energii), BMR/TDEE i nota "to nie porada medyczna". */
@Component({
  selector: 'app-targets-card',
  imports: [TranslocoDirective, NumberPipe],
  template: `
    <section class="card ck-card" *transloco="let t; prefix: 'profile.targets'" aria-live="polite">
      <h2>{{ t('title') }}</h2>
      <p class="kcal">
        <strong>{{ targets().kcal | num: lang() : 0 }}</strong>
        <span>{{ t('kcalPerDay') }}</span>
      </p>
      <ul class="macros">
        @for (m of macros(); track m.key) {
          <li [attr.data-macro]="m.key">
            <div class="row">
              <span class="name">{{ t(m.key) }}</span>
              <span class="value">{{ m.grams | num: lang() : 0 }} g · {{ m.share }}%</span>
            </div>
            <div class="bar" aria-hidden="true"><span [style.width.%]="m.share"></span></div>
          </li>
        }
      </ul>
      <p class="meta">
        {{ t('bmr', { bmr: (targets().bmr | num: lang() : 0), tdee: (targets().tdee | num: lang() : 0) }) }}
      </p>
      @if (targets().clampedToMinimum) {
        <p class="warn" role="note">
          <span class="material-symbols-rounded" aria-hidden="true">info</span>{{ t('clamped') }}
        </p>
      }
      @if (targets().custom) {
        <p class="note">{{ t('custom') }}</p>
      }
      <p class="disclaimer">{{ t('disclaimer') }}</p>
    </section>
  `,
  styles: `
    .card {
      padding: 20px;
      background:
        radial-gradient(
          circle at 100% 0%,
          color-mix(in srgb, var(--ck-accent-from) 18%, transparent),
          transparent 60%
        ),
        var(--ck-surface);
    }
    h2 {
      font-size: 1.1rem;
      margin: 0 0 4px;
    }
    .kcal {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin: 0 0 16px;
      strong {
        font-size: 2.6rem;
        font-weight: 800;
        letter-spacing: -0.02em;
      }
      span {
        color: var(--ck-text-muted);
      }
    }
    .macros {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 0 0 16px;
      padding: 0;
      list-style: none;
    }
    .row {
      display: flex;
      justify-content: space-between;
      font-size: 0.95rem;
      .name {
        font-weight: 700;
      }
      .value {
        font-variant-numeric: tabular-nums;
      }
    }
    .bar {
      height: 8px;
      margin-top: 4px;
      border-radius: 4px;
      background: var(--ck-surface-2);
      span {
        display: block;
        height: 100%;
        border-radius: 4px;
      }
    }
    [data-macro='protein'] .bar span {
      background: var(--ck-sage);
    }
    [data-macro='fat'] .bar span {
      background: var(--ck-accent-from);
    }
    [data-macro='carbs'] .bar span {
      background: var(--ck-accent-to);
    }
    .meta,
    .note,
    .disclaimer {
      margin: 8px 0 0;
      font-size: 0.85rem;
      color: var(--ck-text-muted);
    }
    .warn {
      display: flex;
      gap: 6px;
      margin: 8px 0 0;
      padding: 10px 12px;
      border-radius: var(--ck-radius-sm);
      background: var(--ck-surface-2);
      font-size: 0.9rem;
      .material-symbols-rounded {
        color: var(--ck-link);
      }
    }
  `,
})
export class TargetsCardComponent {
  protected readonly lang = inject(LanguageService).current;
  readonly targets = input.required<Targets>();

  protected readonly macros = computed(() => {
    const t = this.targets();
    const energy = [t.protein * 4, t.fat * 9, t.carbs * 4];
    const total = energy.reduce((a, b) => a + b, 0) || 1;
    return [
      { key: 'protein', grams: t.protein, share: Math.round((energy[0] / total) * 100) },
      { key: 'fat', grams: t.fat, share: Math.round((energy[1] / total) * 100) },
      { key: 'carbs', grams: t.carbs, share: Math.round((energy[2] / total) * 100) },
    ];
  });
}
