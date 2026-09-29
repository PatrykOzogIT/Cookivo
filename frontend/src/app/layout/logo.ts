import { Component } from '@angular/core';

@Component({
  selector: 'app-logo',
  template: `
    <svg class="mark" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="ck-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#F2A65A" />
          <stop offset="1" stop-color="#E8704A" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#ck-logo-g)" />
      <path d="M20 30h24v6a12 12 0 0 1-24 0z" fill="#fff" />
      <path
        d="M26 16c0 3 3 3 3 6M34 16c0 3 3 3 3 6"
        stroke="#fff"
        stroke-width="3"
        stroke-linecap="round"
        fill="none"
      />
      <rect x="16" y="27" width="32" height="4" rx="2" fill="#fff" />
    </svg>
    <span class="word">Cook<span class="accent">ivo</span></span>
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-weight: 800;
      font-size: 1.35rem;
      letter-spacing: -0.02em;
      color: var(--ck-text);
    }
    .mark {
      width: 36px;
      height: 36px;
      filter: drop-shadow(0 4px 10px rgb(232 112 74 / 0.35));
    }
    .accent {
      color: var(--ck-link);
    }
  `,
})
export class LogoComponent {}
