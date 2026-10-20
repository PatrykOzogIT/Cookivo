import { Component, effect, inject, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { AdminSummaryService } from '../../core/admin/admin-summary.service';
import { apiErrorCode } from '../../core/api-error';
import { LocalizedPipe } from '../../core/i18n/format.pipes';
import { LanguageService } from '../../core/i18n/language.service';
import type { Ingredient } from '../ingredients/ingredients.models';
import { IngredientPickerComponent } from '../pantry/ingredient-picker';
import {
  IngredientRequestsApi,
  type AdminIngredientRequest,
  type IngredientRequestStatus,
} from './ingredient-requests.api';

/**
 * Panel admina - zakładka "Prośby o składniki": użytkownik podał pełną nazwę produktu
 * (np. z nierozpoznanej pozycji paragonu). Admin dodaje składnik zwykłym formularzem (link z nazwą)
 * albo wskazuje istniejący - prośba się zamyka, a tekst z paragonu zostaje powiązany ze składnikiem.
 */
@Component({
  selector: 'app-admin-ingredient-requests-panel',
  imports: [
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    TranslocoDirective,
    LocalizedPipe,
    IngredientPickerComponent,
  ],
  template: `
    <ng-container *transloco="let t; prefix: 'admin.requests'">
      <div class="box-head">
        <h2 id="requests-title">{{ t('title') }}</h2>
        <mat-button-toggle-group
          [value]="status()"
          (change)="status.set($event.value)"
          [attr.aria-label]="t('statusLabel')"
          hideSingleSelectionIndicator
        >
          @for (s of statuses; track s) {
            <mat-button-toggle [value]="s">{{ t('status.' + s) }}</mat-button-toggle>
          }
        </mat-button-toggle-group>
      </div>
      <p class="muted">{{ t('lead') }}</p>

      @if (error(); as code) {
        <p class="alert" role="alert" *transloco="let tr">{{ tr('errors.' + code) }}</p>
      }
      @if (loading()) {
        <p class="muted" role="status">{{ t('loading') }}</p>
      } @else if (!items().length) {
        <p class="muted">{{ t('empty') }}</p>
      } @else {
        <ul class="queue">
          @for (r of items(); track r.id) {
            <li class="ck-card item" [attr.aria-labelledby]="'r-' + r.id">
              <h3 [id]="'r-' + r.id">{{ r.name }}</h3>
              <p class="sub">
                @if (r.receiptText) {
                  <span class="receipt-text">{{ r.receiptText }}</span>
                }
                @if (r.storeName) {
                  <span>{{ r.storeName }}</span>
                }
                <span>{{ t('by', { name: r.user }) }}</span>
                <span>{{ formatDate(r.createdAt) }}</span>
              </p>
              @if (r.ingredient; as ing) {
                <p class="sub">{{ t('linked', { name: (ing | localized: lang()) }) }}</p>
              }
              @if (r.status === 'OPEN') {
                @if (linking() === r.id) {
                  <div class="link">
                    <app-ingredient-picker [label]="t('pick')" (picked)="resolve(r, $event)" />
                    <button mat-button type="button" (click)="linking.set(null)" *transloco="let tr">
                      {{ tr('common.cancel') }}
                    </button>
                  </div>
                } @else {
                  <div class="row">
                    <a mat-stroked-button routerLink="/ingredients/new" [queryParams]="{ name: r.name }">
                      <span class="material-symbols-rounded" aria-hidden="true">add</span>{{ t('add') }}
                    </a>
                    <button
                      mat-stroked-button
                      type="button"
                      (click)="linking.set(r.id)"
                      [disabled]="!!busy()"
                    >
                      <span class="material-symbols-rounded" aria-hidden="true">link</span>{{ t('link') }}
                    </button>
                    <button
                      mat-button
                      type="button"
                      class="danger-text"
                      (click)="reject(r)"
                      [disabled]="!!busy()"
                    >
                      {{ t('reject') }}
                    </button>
                  </div>
                }
              }
            </li>
          }
        </ul>
      }
    </ng-container>
  `,
  styleUrl: './admin-page.scss',
  styles: `
    .sub {
      display: flex;
      flex-wrap: wrap;
      gap: 2px 12px;
    }
    .receipt-text {
      font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    }
    .link {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
      app-ingredient-picker {
        flex: 1 1 260px;
      }
    }
    .row .material-symbols-rounded {
      margin-right: 4px;
    }
  `,
})
export class AdminIngredientRequestsPanel {
  private readonly api = inject(IngredientRequestsApi);
  private readonly summary = inject(AdminSummaryService);
  protected readonly lang = inject(LanguageService).current;

  protected readonly statuses: IngredientRequestStatus[] = ['OPEN', 'DONE', 'REJECTED'];
  protected readonly status = signal<IngredientRequestStatus>('OPEN');
  protected readonly items = signal<AdminIngredientRequest[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  /** Prośba, przy której wybieramy istniejący składnik */
  protected readonly linking = signal<string | null>(null);

  constructor() {
    effect(() => {
      const status = this.status();
      untracked(() => void this.load(status));
    });
  }

  protected async resolve(r: AdminIngredientRequest, ingredient: Ingredient): Promise<void> {
    if (ingredient.status !== 'APPROVED') {
      this.error.set('INGREDIENT_UNKNOWN');
      return;
    }
    await this.act(r.id, () => this.api.resolve(r.id, ingredient.id));
  }

  protected async reject(r: AdminIngredientRequest): Promise<void> {
    await this.act(r.id, () => this.api.reject(r.id));
  }

  protected formatDate(iso: string): string {
    return new Intl.DateTimeFormat(this.lang(), { dateStyle: 'medium' }).format(new Date(iso));
  }

  private async act(id: string, fn: () => Promise<unknown>): Promise<void> {
    this.busy.set(id);
    this.error.set(null);
    try {
      await fn();
      this.linking.set(null);
      await this.load(this.status());
      void this.summary.refresh(true);
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.busy.set(null);
    }
  }

  private async load(status: IngredientRequestStatus): Promise<void> {
    this.loading.set(true);
    try {
      this.items.set(await this.api.list(status));
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.loading.set(false);
    }
  }
}
