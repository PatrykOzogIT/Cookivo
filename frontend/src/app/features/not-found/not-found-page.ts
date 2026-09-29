import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';

@Component({
  selector: 'app-not-found-page',
  imports: [RouterLink, MatButtonModule, TranslocoDirective],
  template: `
    <section class="wrap" *transloco="let t">
      <p class="code gradient-text" aria-hidden="true">404</p>
      <h1>{{ t('notFound.title') }}</h1>
      <p>{{ t('notFound.body') }}</p>
      <a mat-flat-button class="ck-cta" routerLink="/">{{ t('notFound.home') }}</a>
    </section>
  `,
  styles: `
    .wrap {
      max-width: 520px;
      margin: 0 auto;
      padding: 64px var(--ck-gutter) 0;
      text-align: center;
    }
    .code {
      margin: 0;
      font-size: 6rem;
      font-weight: 800;
      line-height: 1;
    }
    p {
      color: var(--ck-text-muted);
    }
  `,
})
export class NotFoundPage {}
