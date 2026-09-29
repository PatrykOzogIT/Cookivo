import { Component, input } from '@angular/core';

/** Wspólna "karta" dla stron logowania, rejestracji i odzyskiwania hasła. */
@Component({
  selector: 'app-auth-shell',
  template: `
    <div class="wrap">
      <div class="card ck-card">
        @if (icon()) {
          <div class="icon" aria-hidden="true">
            <span class="material-symbols-rounded filled">{{ icon() }}</span>
          </div>
        }
        <h1>{{ heading() }}</h1>
        @if (subheading()) {
          <p class="sub">{{ subheading() }}</p>
        }
        <ng-content />
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      padding: 32px max(var(--ck-gutter), env(safe-area-inset-right)) 0
        max(var(--ck-gutter), env(safe-area-inset-left));
    }
    .wrap {
      position: relative;
      max-width: 480px;
      margin: 0 auto;
    }
    // Miękka gradientowa poświata za kartą
    .wrap::before {
      content: '';
      position: absolute;
      inset: -40px -60px auto;
      height: 260px;
      background: radial-gradient(
        closest-side,
        color-mix(in srgb, var(--ck-accent-from) 35%, transparent),
        transparent
      );
      filter: blur(20px);
      z-index: -1;
      pointer-events: none;
    }
    .card {
      padding: 32px 28px;
    }
    .icon {
      display: grid;
      place-items: center;
      width: 56px;
      height: 56px;
      margin-bottom: 16px;
      border-radius: 16px;
      background: linear-gradient(135deg, var(--ck-accent-from), var(--ck-accent-to));
      color: #fff;
      box-shadow: 0 8px 20px rgb(232 112 74 / 0.35);
      .material-symbols-rounded {
        font-size: 30px;
      }
    }
    h1 {
      font-size: 1.6rem;
      margin-bottom: 6px;
    }
    .sub {
      margin: 0 0 24px;
      color: var(--ck-text-muted);
    }
    @media (max-width: 480px) {
      :host {
        padding-top: 16px;
      }
      .card {
        padding: 24px 18px;
        border-radius: 20px;
      }
    }
  `,
})
export class AuthShellComponent {
  readonly heading = input.required<string>();
  readonly subheading = input<string>();
  readonly icon = input<string>();
}
