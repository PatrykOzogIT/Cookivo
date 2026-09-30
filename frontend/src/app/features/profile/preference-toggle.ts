import { Component, ViewEncapsulation, input, output } from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { TranslocoDirective } from '@jsverse/transloco';
import type { PreferenceLevel } from './profile.api';

export const LEVELS: (PreferenceLevel | 'NEUTRAL')[] = ['NEVER', 'SOMETIMES', 'NEUTRAL', 'LIKE', 'LOVE'];

export const PREFERENCE_ICONS: Record<PreferenceLevel | 'NEUTRAL', string> = {
  NEVER: 'block',
  SOMETIMES: 'remove',
  NEUTRAL: 'radio_button_unchecked',
  LIKE: 'thumb_up',
  LOVE: 'favorite',
};

/** Pięciostopniowy wybór preferencji (grupa przełączników - obsługa strzałkami z klawiatury). */
@Component({
  selector: 'app-preference-toggle',
  imports: [MatButtonToggleModule, TranslocoDirective],
  template: `
    <mat-button-toggle-group
      *transloco="let t; prefix: 'profile.levels'"
      [value]="value() ?? 'NEUTRAL'"
      (change)="changed.emit($event.value === 'NEUTRAL' ? null : $event.value)"
      [attr.aria-label]="label()"
      hideSingleSelectionIndicator
      class="levels"
    >
      @for (l of levels; track l) {
        <mat-button-toggle [value]="l" [attr.data-level]="l">
          <span class="material-symbols-rounded" aria-hidden="true">{{ icons[l] }}</span>
          <span class="text">{{ t(l) }}</span>
        </mat-button-toggle>
      }
    </mat-button-toggle-group>
  `,
  // Bez enkapsulacji - trzeba dostać się do wnętrza mat-button-toggle; selektory zawężone do hosta
  encapsulation: ViewEncapsulation.None,
  styles: `
    app-preference-toggle {
      display: block;
      max-width: 460px;
    }
    app-preference-toggle .mat-button-toggle-group.levels {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      width: 100%;
      border-radius: 12px;
    }
    app-preference-toggle .mat-button-toggle-button {
      width: 100%;
      height: 100%;
    }
    app-preference-toggle .mat-button-toggle-label-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 6px 2px;
      line-height: 1.1;
      min-height: 44px;
      font-size: 0.72rem;
      white-space: normal;
      text-align: center;
    }
    app-preference-toggle .material-symbols-rounded {
      font-size: 20px;
    }
    app-preference-toggle .mat-button-toggle-checked[data-level='NEVER'] {
      background: color-mix(in srgb, var(--ck-danger) 16%, transparent);
    }
    app-preference-toggle .mat-button-toggle-checked[data-level='LIKE'],
    app-preference-toggle .mat-button-toggle-checked[data-level='LOVE'] {
      background: var(--ck-sage-bg);
    }
  `,
})
export class PreferenceToggleComponent {
  readonly value = input<PreferenceLevel | null>(null);
  readonly label = input.required<string>();
  readonly changed = output<PreferenceLevel | null>();

  protected readonly levels = LEVELS;
  protected readonly icons = PREFERENCE_ICONS;
}
