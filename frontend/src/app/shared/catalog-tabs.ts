import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';

/** Przełącznik "Przepisy | Składniki" - na telefonie jedyna droga do składników (dolny pasek ma 5 pozycji). */
@Component({
  selector: 'app-catalog-tabs',
  imports: [RouterLink, RouterLinkActive, TranslocoDirective],
  template: `
    <nav class="tabs" *transloco="let t" [attr.aria-label]="t('catalog.label')">
      <a routerLink="/recipes" routerLinkActive="active" ariaCurrentWhenActive="page">
        <span class="material-symbols-rounded" aria-hidden="true">restaurant_menu</span>
        {{ t('nav.recipes') }}
      </a>
      <a routerLink="/ingredients" routerLinkActive="active" ariaCurrentWhenActive="page">
        <span class="material-symbols-rounded" aria-hidden="true">nutrition</span>
        {{ t('nav.ingredients') }}
      </a>
    </nav>
  `,
  styles: `
    .tabs {
      display: inline-flex;
      gap: 4px;
      padding: 4px;
      margin-bottom: 20px;
      border-radius: 14px;
      background: var(--ck-surface-2);
      border: 1px solid var(--ck-border);
    }
    a {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 44px;
      padding: 0 16px;
      border-radius: 10px;
      color: var(--ck-text-muted);
      font-weight: 600;
      text-decoration: none;
      transition:
        background 0.2s ease,
        color 0.2s ease;
      .material-symbols-rounded {
        font-size: 20px;
      }
      &.active {
        background: var(--ck-surface);
        color: var(--ck-link);
        box-shadow: var(--ck-shadow);
      }
    }
    @media (min-width: 768px) {
      // Na desktopie składniki są w menu głównym
      :host {
        display: none;
      }
    }
  `,
})
export class CatalogTabsComponent {}
