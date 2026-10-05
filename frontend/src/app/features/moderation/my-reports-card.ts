import { Component, inject, signal, type OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { LanguageService } from '../../core/i18n/language.service';
import { ReportsApi, type MyReport } from './reports.api';

/** Ustawienia konta: wysłane zgłoszenia i ich status (zgłaszający nie dostaje maili) */
@Component({
  selector: 'app-my-reports-card',
  imports: [RouterLink, TranslocoDirective],
  template: `
    @if (items().length) {
      <section class="ck-card box" aria-labelledby="my-reports-title" *transloco="let t">
        <h2 id="my-reports-title">{{ t('moderation.mineTitle') }}</h2>
        <ul class="list">
          @for (r of items(); track r.id) {
            <li>
              <span class="what">
                {{ t('moderation.target.' + r.targetType) }}:
                @if (r.recipe) {
                  <a [routerLink]="['/recipes', r.recipe.id]">{{ r.recipe.title }}</a>
                }
                @if (r.targetType === 'USER' && r.username) {
                  <strong>{{ r.username }}</strong>
                }
              </span>
              <span class="meta">
                {{ t('moderation.reasons.' + r.reason) }} · {{ formatDate(r.createdAt) }}
              </span>
              <span class="status" [class]="'status s-' + r.status">{{
                t('moderation.status.' + r.status)
              }}</span>
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: `
    .box {
      padding: 16px 20px;
      h2 {
        margin: 0 0 8px;
        font-size: 1.15rem;
      }
    }
    .list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 12px;
      padding: 10px 0;
      border-top: 1px solid var(--ck-border);
    }
    .what {
      flex: 1 1 220px;
      overflow-wrap: anywhere;
      a {
        color: var(--ck-link);
        display: inline-block;
        min-height: 24px;
      }
    }
    .meta {
      font-size: 0.85rem;
      color: var(--ck-text-muted);
    }
    .status {
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 0.8rem;
      font-weight: 700;
      background: var(--ck-surface-2);
    }
    .s-ACCEPTED {
      color: var(--ck-success);
    }
  `,
})
export class MyReportsCard implements OnInit {
  private readonly api = inject(ReportsApi);
  private readonly language = inject(LanguageService);
  protected readonly items = signal<MyReport[]>([]);

  async ngOnInit(): Promise<void> {
    this.items.set(await this.api.mine().catch(() => []));
  }

  protected formatDate(iso: string): string {
    return new Intl.DateTimeFormat(this.language.current(), { dateStyle: 'medium' }).format(new Date(iso));
  }
}
