import { Component, computed, inject, input } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { NumberPipe } from '../../core/i18n/format.pipes';
import { LanguageService } from '../../core/i18n/language.service';
import type { Nutrition } from '../../features/ingredients/ingredients.models';

interface Row {
  key: string;
  per100: number | null;
  perPortion: number | null;
  sub?: boolean;
  unit: string;
  digits: number;
}

/**
 * Tabela wartości odżywczych w kolejności z etykiety UE (rozporządzenie 1169/2011):
 * energia, tłuszcz, w tym nasycone, węglowodany, w tym cukry, błonnik, białko, sól.
 */
@Component({
  selector: 'app-nutrition-table',
  imports: [TranslocoDirective, NumberPipe],
  template: `
    <table *transloco="let t; prefix: 'nutrition'" class="table">
      <caption class="visually-hidden">
        {{
          t('tableCaption')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">
            <span class="visually-hidden">{{ t('nutrient') }}</span>
          </th>
          <th scope="col">{{ t('per100g') }}</th>
          @if (portionGrams()) {
            <th scope="col">{{ portionLabel() || t('perPortion') }}</th>
          }
        </tr>
      </thead>
      <tbody>
        <tr class="energy">
          <th scope="row">{{ t('energy') }}</th>
          <td>
            {{ nutrition().kcal * KJ | num: lang() : 0 }} kJ<br />
            <strong>{{ nutrition().kcal | num: lang() : 0 }} kcal</strong>
          </td>
          @if (portionGrams(); as g) {
            <td>
              {{ (nutrition().kcal * KJ * g) / 100 | num: lang() : 0 }} kJ<br />
              <strong>{{ (nutrition().kcal * g) / 100 | num: lang() : 0 }} kcal</strong>
            </td>
          }
        </tr>
        @for (row of rows(); track row.key) {
          <tr [class.sub]="row.sub">
            <th scope="row">{{ t(row.key) }}</th>
            <td>
              @if (row.per100 === null) {
                <span class="missing" [attr.title]="t('noData')">{{ t('noDataShort') }}</span>
              } @else {
                {{ row.per100 | num: lang() : row.digits }} {{ row.unit }}
              }
            </td>
            @if (portionGrams()) {
              <td>
                @if (row.perPortion === null) {
                  <span class="missing">{{ t('noDataShort') }}</span>
                } @else {
                  {{ row.perPortion | num: lang() : row.digits }} {{ row.unit }}
                }
              </td>
            }
          </tr>
        }
      </tbody>
    </table>
  `,
  styles: `
    .table {
      width: 100%;
      border-collapse: collapse;
      font-variant-numeric: tabular-nums;
    }
    th,
    td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--ck-border);
      text-align: right;
      vertical-align: top;
    }
    th[scope='row'],
    thead th:first-child {
      text-align: left;
      font-weight: 600;
    }
    thead th {
      font-size: 0.85rem;
      color: var(--ck-text-muted);
      font-weight: 600;
    }
    tr.sub th {
      padding-left: 28px;
      font-weight: 400;
      color: var(--ck-text-muted);
    }
    tr.energy td {
      line-height: 1.35;
    }
    .missing {
      color: var(--ck-text-muted);
      font-size: 0.9rem;
    }
  `,
})
export class NutritionTableComponent {
  protected readonly lang = inject(LanguageService).current;
  protected readonly KJ = 4.184;

  readonly nutrition = input.required<Nutrition>();
  /** Opcjonalna porcja w gramach - dodaje drugą kolumnę */
  readonly portionGrams = input<number | null>(null);
  readonly portionLabel = input<string>('');

  protected readonly rows = computed<Row[]>(() => {
    const n = this.nutrition();
    const g = this.portionGrams();
    const row = (key: string, per100: number | null, extra: Partial<Row> = {}): Row => ({
      key,
      per100,
      perPortion: per100 === null || !g ? null : (per100 * g) / 100,
      unit: 'g',
      digits: 1,
      ...extra,
    });
    return [
      row('fat', n.fat),
      row('saturatedFat', n.saturatedFat, { sub: true }),
      row('carbs', n.carbs),
      row('sugars', n.sugars, { sub: true }),
      row('fiber', n.fiber),
      row('protein', n.protein),
      row('salt', n.salt, { digits: 2 }),
    ];
  });
}
