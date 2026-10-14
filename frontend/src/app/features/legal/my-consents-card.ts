import { Component, computed, inject, type OnInit } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { LanguageService } from '../../core/i18n/language.service';
import { LegalService } from './legal';

/** Ustawienia konta: historia zgód (RODO art. 7 - użytkownik widzi, na co i kiedy się zgodził) */
@Component({
  selector: 'app-my-consents-card',
  imports: [TranslocoDirective],
  template: `
    <section class="ck-card box" aria-labelledby="consents-title" *transloco="let t">
      <h2 id="consents-title">{{ t('legal.consents.title') }}</h2>
      <p class="muted">{{ t('legal.consents.intro') }}</p>
      @if (items().length) {
        <ul class="list">
          @for (c of items(); track c.id) {
            <li>
              <span class="what">{{ t('legal.consents.types.' + c.type) }}</span>
              <span class="meta">
                {{ t('legal.consents.version', { version: c.version }) }} ·
                {{ t('legal.consents.granted', { date: formatDate(c.grantedAt) }) }}
                @if (c.revokedAt) {
                  · <strong>{{ t('legal.consents.revoked', { date: formatDate(c.revokedAt) }) }}</strong>
                }
              </span>
            </li>
          }
        </ul>
      } @else {
        <p>{{ t('legal.consents.empty') }}</p>
      }
    </section>
  `,
  styles: `
    .box {
      padding: 16px 20px;
      h2 {
        margin: 0 0 8px;
        font-size: 1.15rem;
      }
    }
    .muted {
      color: var(--ck-text-muted);
    }
    .list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 4px 12px;
      padding: 10px 0;
      border-top: 1px solid var(--ck-border);
    }
    .what {
      flex: 1 1 220px;
      font-weight: 600;
    }
    .meta {
      font-size: 0.85rem;
      color: var(--ck-text-muted);
    }
  `,
})
export class MyConsentsCard implements OnInit {
  private readonly legal = inject(LegalService);
  private readonly language = inject(LanguageService);

  protected readonly items = computed(() => this.legal.status()?.consents ?? []);

  ngOnInit(): void {
    void this.legal.load().catch(() => undefined);
  }

  protected formatDate(iso: string): string {
    return new Intl.DateTimeFormat(this.language.current(), { dateStyle: 'medium' }).format(new Date(iso));
  }
}
