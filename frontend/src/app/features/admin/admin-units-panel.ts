import { Component, inject, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { AdminSummaryService } from '../../core/admin/admin-summary.service';
import { apiErrorCode } from '../../core/api-error';
import { LocalizedPipe, NumberPipe, formatNumber, parseDecimal } from '../../core/i18n/format.pipes';
import { LanguageService } from '../../core/i18n/language.service';
import { UNIT_RANGES } from '../recipes/kitchen-units';
import { AdminUnitsApi, type UnitEstimateRow, type UnitSuggestion } from './units.api';

/**
 * Panel admina - zakładka "Miary": wagi miar kuchennych (łyżka, łyżeczka, szklanka, szczypta, sztuka).
 * Propozycje użytkowników (waga z ich przepisu) zatwierdzone trafiają do składnika dla wszystkich;
 * szacunki AI są już w użyciu - admin może je potwierdzić albo poprawić.
 */
@Component({
  selector: 'app-admin-units-panel',
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    TranslocoDirective,
    LocalizedPipe,
    NumberPipe,
  ],
  template: `
    <ng-container *transloco="let t; prefix: 'admin.units'">
      <h2 id="units-title">{{ t('title') }}</h2>
      <p class="muted">{{ t('lead') }}</p>
      @if (error(); as code) {
        <p class="alert" role="alert" *transloco="let tr">{{ tr('errors.' + code) }}</p>
      }

      <h3>{{ t('suggestions') }}</h3>
      @if (loading()) {
        <p class="muted" role="status">{{ t('loading') }}</p>
      } @else if (!suggestions().length) {
        <p class="muted">{{ t('noSuggestions') }}</p>
      } @else {
        <ul class="queue">
          @for (s of suggestions(); track s.id) {
            <li class="ck-card item" [attr.aria-labelledby]="'us-' + s.id">
              <h4 [id]="'us-' + s.id">
                1 {{ s.unit | localized: lang() }} –
                <a [routerLink]="['/ingredients', s.ingredient.id]">{{ s.ingredient | localized: lang() }}</a>
              </h4>
              <p class="sub">
                <span>{{ t('proposed', { grams: (s.grams | num: lang() : 2) }) }}</span>
                @if (s.current !== null) {
                  <span>{{ t('current', { grams: (s.current | num: lang() : 2) }) }}</span>
                }
                <span>{{ t('by', { name: s.username ?? '-' }) }}</span>
              </p>
              <div class="row">
                <mat-form-field subscriptSizing="dynamic" class="grams">
                  <mat-label>{{ t('grams') }}</mat-label>
                  <input
                    matInput
                    type="text"
                    inputmode="decimal"
                    autocomplete="off"
                    [ngModel]="draft(s.id, s.grams)"
                    (ngModelChange)="setDraft(s.id, $event)"
                  />
                  <span matTextSuffix>g</span>
                </mat-form-field>
                <button mat-flat-button type="button" (click)="approve(s)" [disabled]="!!busy()">
                  {{ t('approve') }}
                </button>
                <button
                  mat-button
                  type="button"
                  class="danger-text"
                  (click)="reject(s)"
                  [disabled]="!!busy()"
                >
                  {{ t('reject') }}
                </button>
              </div>
            </li>
          }
        </ul>
      }

      <h3>{{ t('estimates') }}</h3>
      <p class="muted">{{ t('estimatesLead') }}</p>
      <mat-form-field subscriptSizing="dynamic" class="search">
        <mat-label>{{ t('search') }}</mat-label>
        <input matInput type="search" autocomplete="off" [ngModel]="q()" (ngModelChange)="search($event)" />
      </mat-form-field>
      @if (estimates().length) {
        <ul class="estimates">
          @for (e of estimates(); track e.ingredient.id + e.unit.code) {
            <li>
              <span class="name">
                <a [routerLink]="['/ingredients', e.ingredient.id]">{{ e.ingredient | localized: lang() }}</a>
                – 1 {{ e.unit | localized: lang() }}
              </span>
              <mat-form-field subscriptSizing="dynamic" class="grams">
                <mat-label>{{ t('grams') }}</mat-label>
                <input
                  matInput
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  [ngModel]="draft(key(e), e.grams)"
                  (ngModelChange)="setDraft(key(e), $event)"
                />
                <span matTextSuffix>g</span>
              </mat-form-field>
              <button mat-stroked-button type="button" (click)="confirm(e)" [disabled]="!!busy()">
                {{ t('confirm') }}
              </button>
            </li>
          }
        </ul>
        <p class="muted small">{{ t('estimatesCount', { shown: estimates().length, total: total() }) }}</p>
        @if (estimates().length < total()) {
          <button mat-button type="button" (click)="more()">{{ t('more') }}</button>
        }
      } @else if (!loading()) {
        <p class="muted">{{ t('noEstimates') }}</p>
      }
    </ng-container>
  `,
  styleUrl: './admin-page.scss',
  styles: `
    h3 {
      margin: 20px 0 8px;
      font-size: 1.05rem;
    }
    h4 {
      margin: 0;
      font-size: 1rem;
    }
    .sub {
      display: flex;
      flex-wrap: wrap;
      gap: 2px 12px;
    }
    .row,
    .estimates li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      margin-top: 8px;
    }
    .grams {
      width: 140px;
    }
    .search {
      width: min(100%, 360px);
    }
    .estimates {
      list-style: none;
      margin: 8px 0 0;
      padding: 0;
      li {
        padding: 6px 0;
        border-bottom: 1px solid var(--ck-border);
      }
      .name {
        flex: 1 1 220px;
      }
    }
  `,
})
export class AdminUnitsPanel implements OnInit {
  private readonly api = inject(AdminUnitsApi);
  private readonly summary = inject(AdminSummaryService);
  protected readonly lang = inject(LanguageService).current;

  protected readonly suggestions = signal<UnitSuggestion[]>([]);
  protected readonly estimates = signal<UnitEstimateRow[]>([]);
  protected readonly total = signal(0);
  protected readonly q = signal('');
  protected readonly loading = signal(true);
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  private readonly drafts = signal(new Map<string, string>());
  private page = 1;
  private searchTimer?: ReturnType<typeof setTimeout>;

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadSuggestions(), this.loadEstimates(true)]);
    this.loading.set(false);
  }

  protected key(e: UnitEstimateRow): string {
    return `${e.ingredient.id}|${e.unit.code}`;
  }

  /** Wartość w polu: wpisana przez admina albo obecna */
  protected draft(id: string, grams: number): string {
    return this.drafts().get(id) ?? formatNumber(grams, this.lang(), 2);
  }

  protected setDraft(id: string, value: string): void {
    this.drafts.update((m) => new Map(m).set(id, value));
  }

  protected search(value: string): void {
    this.q.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.loadEstimates(true), 300);
  }

  protected more(): void {
    this.page++;
    void this.loadEstimates(false);
  }

  protected approve(s: UnitSuggestion): Promise<void> {
    const grams = this.grams(s.id, s.grams, s.unit.code);
    if (grams === null) return Promise.resolve();
    return this.act(s.id, () => this.api.approve(s.id, grams));
  }

  protected reject(s: UnitSuggestion): Promise<void> {
    return this.act(s.id, () => this.api.reject(s.id));
  }

  protected confirm(e: UnitEstimateRow): Promise<void> {
    const grams = this.grams(this.key(e), e.grams, e.unit.code);
    if (grams === null) return Promise.resolve();
    return this.act(this.key(e), () => this.api.set(e.ingredient.id, e.unit.code, grams));
  }

  /** Waga z pola, sprawdzona z zakresem miary (ten sam co na serwerze) */
  private grams(id: string, fallback: number, unitCode: string): number | null {
    const raw = this.drafts().get(id);
    const v = raw === undefined ? fallback : parseDecimal(raw);
    const [min, max] = UNIT_RANGES[unitCode] ?? [0.01, 5000];
    if (v === null || Number.isNaN(v) || v < min || v > max) {
      this.error.set('UNIT_GRAMS_INVALID');
      return null;
    }
    return v;
  }

  private async act(id: string, fn: () => Promise<unknown>): Promise<void> {
    this.busy.set(id);
    this.error.set(null);
    try {
      await fn();
      this.drafts.update((m) => {
        const next = new Map(m);
        next.delete(id);
        return next;
      });
      await Promise.all([this.loadSuggestions(), this.loadEstimates(true)]);
      void this.summary.refresh(true);
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.busy.set(null);
    }
  }

  private async loadSuggestions(): Promise<void> {
    try {
      this.suggestions.set(await this.api.suggestions());
    } catch (err) {
      this.error.set(apiErrorCode(err));
    }
  }

  private async loadEstimates(reset: boolean): Promise<void> {
    if (reset) this.page = 1;
    try {
      const res = await this.api.estimates(this.q().trim(), this.page);
      this.total.set(res.total);
      this.estimates.update((list) => (reset ? res.items : [...list, ...res.items]));
    } catch (err) {
      this.error.set(apiErrorCode(err));
    }
  }
}
