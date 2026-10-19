import { Component, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslocoDirective } from '@jsverse/transloco';
import { CURRENCIES, type Currency } from './prices.api';

/**
 * Formularz nowego cennika (nazwa + waluta) - na stronie cenników i w imporcie paragonu.
 * Sam niczego nie zapisuje: oddaje dane przez `submitted`.
 */
@Component({
  selector: 'app-price-list-form',
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    TranslocoDirective,
  ],
  template: `
    <form class="ck-card box new-list" (ngSubmit)="submit()" novalidate *transloco="let t">
      <h2>{{ heading() }}</h2>
      @if (hint()) {
        <p class="hint lead-hint">{{ hint() }}</p>
      }
      <div class="fields">
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>{{ t('prices.name') }}</mat-label>
          <input
            matInput
            name="name"
            [ngModel]="name()"
            (ngModelChange)="name.set($event)"
            maxlength="60"
            autocomplete="off"
            [placeholder]="t('prices.namePlaceholder')"
          />
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>{{ t('prices.currency') }}</mat-label>
          <mat-select name="currency" [ngModel]="currency()" (ngModelChange)="currency.set($event)">
            @for (c of currencies; track c) {
              <mat-option [value]="c">{{ c }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>
      <div class="row">
        <button mat-stroked-button type="submit" [disabled]="busy() || !name().trim()">
          <span class="material-symbols-rounded" aria-hidden="true">add</span
          >{{ submitLabel() || t('prices.create') }}
        </button>
        @if (cancellable()) {
          <button mat-button type="button" (click)="cancelled.emit()">{{ t('common.cancel') }}</button>
        }
      </div>
    </form>
  `,
  styleUrls: ['../pantry/pantry-page.scss'],
  styles: `
    .fields {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
    }
    .lead-hint {
      margin: 0 0 12px;
      font-size: 0.9rem;
    }
  `,
})
export class PriceListForm {
  readonly heading = input.required<string>();
  readonly hint = input<string>('');
  readonly submitLabel = input<string>('');
  readonly busy = input(false);
  readonly cancellable = input(false);
  readonly name = model('');
  readonly currency = model<Currency>('PLN');

  readonly submitted = output<{ name: string; currency: Currency }>();
  readonly cancelled = output<void>();

  protected readonly currencies = CURRENCIES;

  protected submit(): void {
    const name = this.name().trim();
    if (name) this.submitted.emit({ name, currency: this.currency() });
  }
}
