import { Component, computed, input, model } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoDirective } from '@jsverse/transloco';
import { parseDecimal } from '../../core/i18n/format.pipes';
import { formatServings } from './plan-math';

/** Liczba porcji: przyciski −/+ (duże cele dotyku) i pole do wpisania ułamka (0,5). */
@Component({
  selector: 'app-servings-stepper',
  imports: [MatButtonModule, TranslocoDirective],
  template: `
    <div class="stepper" role="group" [attr.aria-labelledby]="id() + '-label'" *transloco="let t">
      <span class="label" [id]="id() + '-label'">{{ label() }}</span>
      <div class="controls">
        <button
          mat-icon-button
          type="button"
          (click)="step(-1)"
          [disabled]="value() <= min()"
          [attr.aria-label]="t('planner.decrease')"
        >
          <span class="material-symbols-rounded" aria-hidden="true">remove</span>
        </button>
        <input
          [id]="id()"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          [value]="text()"
          (change)="typed($any($event.target))"
          [attr.aria-label]="label()"
        />
        <button
          mat-icon-button
          type="button"
          (click)="step(1)"
          [disabled]="value() >= max()"
          [attr.aria-label]="t('planner.increase')"
        >
          <span class="material-symbols-rounded" aria-hidden="true">add</span>
        </button>
      </div>
    </div>
  `,
  styles: `
    .stepper {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .label {
      font-weight: 600;
    }
    .controls {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    input {
      width: 4.5em;
      min-height: 44px;
      text-align: center;
      font: inherit;
      font-weight: 700;
      color: var(--ck-text);
      background: var(--ck-surface);
      border: 1px solid var(--ck-border);
      border-radius: var(--ck-radius-sm);
    }
  `,
})
export class ServingsStepperComponent {
  readonly id = input.required<string>();
  readonly label = input.required<string>();
  readonly lang = input('pl');
  readonly min = input(0.25);
  readonly max = input(50);
  readonly value = model.required<number>();

  protected readonly text = computed(() => formatServings(this.value(), this.lang()));

  protected step(dir: 1 | -1): void {
    // Krok 1 porcji, a z ułamka - do najbliższej całości
    const v = this.value();
    const next = dir > 0 ? Math.floor(v) + 1 : Math.ceil(v) - 1;
    this.set(next < this.min() ? this.min() : next);
  }

  protected typed(el: HTMLInputElement): void {
    const n = parseDecimal(el.value);
    if (n !== null && !Number.isNaN(n)) this.set(Math.round(n * 4) / 4);
    // Pole zawsze pokazuje aktualną (poprawioną) wartość
    el.value = this.text();
  }

  private set(n: number): void {
    this.value.set(Math.min(this.max(), Math.max(this.min(), n)));
  }
}
