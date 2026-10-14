import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { switchMap } from 'rxjs';
import { LanguageService } from '../../core/i18n/language.service';
import { LEGAL_EFFECTIVE, segments } from './legal';

interface LegalDoc {
  title: string;
  intro: string;
  sections: { title: string; body: (string | string[])[] }[];
}

/** Transloco potrafi oddać tablice z JSON-a jako obiekty z kluczami "0", "1"... */
function list<T>(value: T[] | Record<string, T> | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : Object.values(value);
}

/**
 * Regulamin i polityka prywatności. Treść w i18n (`legal.termsDoc` / `legal.privacyDoc`):
 * blok-tekst = akapit, blok-tablica = lista. Wersja obowiązująca = LEGAL_EFFECTIVE.
 */
@Component({
  selector: 'app-legal-page',
  imports: [TranslocoDirective, NgTemplateOutlet],
  template: `
    <article class="wrap" *transloco="let t">
      @if (content(); as d) {
        <h1>{{ d.title }}</h1>
        <p class="meta">
          <span>{{ t('legal.effective', { date: effective() }) }}</span>
          <button type="button" class="print-btn" (click)="print()">
            <span class="material-symbols-rounded" aria-hidden="true">download</span>
            {{ t('legal.print') }}
          </button>
        </p>
        <p class="intro">{{ d.intro }}</p>
        @for (s of d.sections; track $index) {
          <section [attr.aria-labelledby]="'sec-' + $index">
            <h2 [id]="'sec-' + $index">{{ $index + 1 }}. {{ s.title }}</h2>
            @for (b of s.body; track $index) {
              @if (isList(b)) {
                <ul>
                  @for (item of b; track $index) {
                    <li><ng-container *ngTemplateOutlet="rich; context: { $implicit: item }" /></li>
                  }
                </ul>
              } @else {
                <p><ng-container *ngTemplateOutlet="rich; context: { $implicit: b }" /></p>
              }
            }
          </section>
        }
      }
    </article>

    <!-- Tekst z klikalnymi adresami - w jednej linii, żeby białe znaki szablonu nie dawały spacji przed kropką -->
    <ng-template #rich let-text>
      <!-- prettier-ignore -->
      @for (seg of split(text); track $index) {@switch (seg.kind) {@case ('mail') {<a [href]="'mailto:' + seg.value">{{ seg.value }}</a>} @case ('url') {<a [href]="seg.value" target="_blank" rel="noopener noreferrer">{{ seg.value }}</a>} @default {{{ seg.value }}}}}
    </ng-template>
  `,
  styles: `
    .wrap {
      max-width: 760px;
      margin: 0 auto;
      padding: 40px var(--ck-gutter) 24px;
      line-height: 1.6;
    }
    h2 {
      font-size: 1.15rem;
      margin-top: 32px;
    }
    ul {
      padding-left: 1.25rem;
    }
    li + li {
      margin-top: 6px;
    }
    a {
      overflow-wrap: anywhere;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 16px;
      color: var(--ck-text-muted);
    }
    .intro {
      font-size: 1.05rem;
    }
    .print-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 44px;
      padding: 0 12px;
      border: 1px solid var(--ck-border);
      border-radius: var(--ck-radius-sm);
      background: var(--ck-surface);
      color: var(--ck-text);
      font: inherit;
      cursor: pointer;
    }
    @media print {
      .print-btn {
        display: none;
      }
    }
  `,
})
export class LegalPage {
  private readonly transloco = inject(TranslocoService);
  private readonly language = inject(LanguageService);

  /** Parametr trasy :doc */
  readonly doc = input<string>('privacy');
  private readonly docKey = computed(() => (this.doc() === 'terms' ? 'termsDoc' : 'privacyDoc'));

  private readonly raw = toSignal(
    toObservable(this.docKey).pipe(switchMap((key) => this.transloco.selectTranslateObject(`legal.${key}`))),
  );

  protected readonly content = computed<LegalDoc | null>(() => {
    const d = this.raw() as (Omit<LegalDoc, 'sections'> & { sections: unknown }) | undefined;
    if (!d?.title) return null;
    return {
      title: d.title,
      intro: d.intro,
      sections: list(d.sections as LegalDoc['sections']).map((s) => ({
        title: s.title,
        body: list(s.body as unknown as (string | string[])[]).map((b) =>
          typeof b === 'string' ? b : list(b),
        ),
      })),
    };
  });

  protected readonly effective = computed(() =>
    new Intl.DateTimeFormat(this.language.current(), { dateStyle: 'long' }).format(
      new Date(`${LEGAL_EFFECTIVE}T12:00:00`),
    ),
  );

  protected readonly split = segments;

  protected isList(b: string | string[]): b is string[] {
    return Array.isArray(b);
  }

  protected print(): void {
    window.print();
  }
}
