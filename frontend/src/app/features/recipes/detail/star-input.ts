import { Component, input, model } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * Wybór 1-5 gwiazdek. Pod spodem zwykłe przyciski radio - strzałki z klawiatury i czytnik
 * ekranu działają bez dodatkowego kodu; widać tylko duże gwiazdki (cel dotyku 44 px).
 */
@Component({
  selector: 'app-star-input',
  imports: [TranslocoDirective],
  template: `
    <fieldset class="star-input" *transloco="let t">
      <legend>{{ label() }}</legend>
      <div class="row">
        @for (s of [1, 2, 3, 4, 5]; track s) {
          <label [class.on]="s <= (value() ?? 0)">
            <input
              type="radio"
              [name]="name()"
              [value]="s"
              [checked]="value() === s"
              (change)="value.set(s)"
            />
            <span class="material-symbols-rounded" aria-hidden="true">star</span>
            <span class="visually-hidden">{{ t('ratings.starsLabel', { count: s }) }}</span>
          </label>
        }
      </div>
    </fieldset>
  `,
  styles: `
    .star-input {
      margin: 0;
      padding: 0;
      border: 0;
    }
    legend {
      font-weight: 600;
      margin-bottom: 4px;
    }
    .row {
      display: flex;
      gap: 2px;
    }
    label {
      position: relative;
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      cursor: pointer;
    }
    input {
      position: absolute;
      opacity: 0;
      width: 1px;
      height: 1px;
    }
    .material-symbols-rounded {
      font-size: 30px;
      color: var(--ck-text-muted);
    }
    label.on .material-symbols-rounded {
      color: var(--ck-accent-to);
      font-variation-settings: 'FILL' 1;
    }
    label:has(input:focus-visible) {
      outline: 3px solid var(--ck-focus);
      outline-offset: 1px;
    }
  `,
})
export class StarInputComponent {
  readonly label = input.required<string>();
  readonly name = input('stars');
  readonly value = model<number | null>(null);
}
