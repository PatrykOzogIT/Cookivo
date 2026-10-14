import { Component, computed, effect, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { AuthService } from '../../core/auth/auth.service';
import { LegalService } from './legal';

/**
 * Po zmianie regulaminu lub polityki prywatności zalogowany użytkownik widzi prośbę o akceptację
 * nowej wersji (backend: GET /api/me/legal → pending). Nie blokuje korzystania z serwisu.
 */
@Component({
  selector: 'app-legal-update-banner',
  imports: [TranslocoDirective, RouterLink, MatButtonModule],
  template: `
    @if (pending().length) {
      <section class="banner" role="region" [attr.aria-labelledby]="'legal-update-title'" *transloco="let t">
        <div class="inner">
          <span class="material-symbols-rounded icon" aria-hidden="true">description</span>
          <div class="text">
            <h2 id="legal-update-title">{{ t('legal.update.title') }}</h2>
            <p>
              {{ t('legal.update.body') }}
              @for (d of pending(); track d.type; let last = $last) {
                <a [routerLink]="d.type === 'TERMS' ? '/legal/terms' : '/legal/privacy'">{{
                  t(d.type === 'TERMS' ? 'legal.terms' : 'legal.privacy')
                }}</a
                >{{ last ? '.' : ',' }}
              }
            </p>
            <p class="small">{{ t('legal.update.decline') }}</p>
          </div>
          <button mat-flat-button class="ck-cta" type="button" [disabled]="busy()" (click)="accept()">
            {{ t('legal.update.accept') }}
          </button>
        </div>
      </section>
    }
  `,
  styles: `
    .banner {
      background: var(--ck-surface-2);
      border-bottom: 1px solid var(--ck-border);
    }
    .inner {
      /* jak .container z app.scss (style App nie sięgają do komponentów potomnych) */
      width: 100%;
      max-width: var(--ck-content-max);
      margin: 0 auto;
      padding-left: max(var(--ck-gutter), env(safe-area-inset-left));
      padding-right: max(var(--ck-gutter), env(safe-area-inset-right));
      box-sizing: border-box;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px 16px;
      padding-block: 14px;
    }
    .icon {
      color: var(--ck-link);
    }
    .text {
      flex: 1 1 260px;
    }
    h2 {
      font-size: 1rem;
      margin: 0 0 4px;
    }
    p {
      margin: 0;
    }
    .small {
      font-size: 0.875rem;
      color: var(--ck-text-muted);
      margin-top: 4px;
    }
    button {
      min-height: 44px;
    }
  `,
})
export class LegalUpdateBanner {
  private readonly auth = inject(AuthService);
  private readonly legal = inject(LegalService);
  protected readonly busy = signal(false);

  protected readonly pending = () => this.legal.status()?.pending ?? [];

  /** Id zamiast obiektu - odświeżenie tokenu nie wywołuje ponownego zapytania */
  private readonly userId = computed(() => this.auth.user()?.id ?? null);

  constructor() {
    effect(() => {
      if (this.userId()) void this.legal.load().catch(() => undefined);
      else this.legal.clear();
    });
  }

  protected async accept(): Promise<void> {
    this.busy.set(true);
    try {
      await this.legal.accept();
    } finally {
      this.busy.set(false);
    }
  }
}
