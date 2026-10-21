import { Component, DestroyRef, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../core/api-error';
import { LocalizedPipe } from '../../core/i18n/format.pipes';
import { LanguageService } from '../../core/i18n/language.service';
import { AmountLabelPipe } from '../recipes/amount-label.pipe';
import { ShoppingApi } from '../shopping/shopping.api';
import { AssistantApi, type ParsedItem } from './assistant.api';
import { AssistantStore } from './assistant.store';

/** Minimalny kształt Web Speech API (w przeglądarkach z prefiksem webkit) */
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

/**
 * "Podyktuj albo wklej listę" na liście zakupów: tekst (z mikrofonu przeglądarki albo wpisany)
 * → asystent rozbija go na pozycje z bazy → podgląd z zaznaczaniem → dodanie do listy.
 */
@Component({
  selector: 'app-shopping-dictation',
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    TranslocoDirective,
    LocalizedPipe,
  ],
  template: `
    @if (store.status()?.enabled) {
      <ng-container *transloco="let t; prefix: 'assistant.dictation'">
        @if (!open()) {
          <button mat-stroked-button type="button" class="toggle" (click)="open.set(true)">
            <span class="material-symbols-rounded" aria-hidden="true">mic</span>{{ t('open') }}
          </button>
        } @else {
          <section class="dictation" aria-labelledby="dictation-title">
            <h3 id="dictation-title">{{ t('title') }}</h3>
            <mat-form-field subscriptSizing="dynamic">
              <mat-label>{{ t('label') }}</mat-label>
              <textarea
                matInput
                id="dictation-text"
                name="dictation"
                rows="3"
                maxlength="1000"
                [ngModel]="text()"
                (ngModelChange)="text.set($event)"
                [placeholder]="t('placeholder')"
              ></textarea>
            </mat-form-field>
            <div class="row">
              @if (speech) {
                <button
                  mat-stroked-button
                  type="button"
                  (click)="listening() ? stop() : listen()"
                  [attr.aria-pressed]="listening()"
                >
                  <span class="material-symbols-rounded" aria-hidden="true">{{
                    listening() ? 'stop' : 'mic'
                  }}</span
                  >{{ t(listening() ? 'stop' : 'speak') }}
                </button>
              }
              <button
                mat-flat-button
                class="ck-cta"
                type="button"
                (click)="parse()"
                [disabled]="busy() || !text().trim()"
              >
                {{ t('parse') }}
              </button>
              <button mat-button type="button" (click)="close()">{{ t('close') }}</button>
            </div>
            @if (speech) {
              <p class="hint">{{ t('speechNote') }}</p>
            }
            <div aria-live="polite">
              @if (listening()) {
                <p class="hint">{{ t('listening') }}</p>
              }
              @if (busy()) {
                <mat-progress-bar mode="indeterminate" [attr.aria-label]="t('working')" />
              }
            </div>
            @if (error(); as code) {
              <p class="alert" role="alert" *transloco="let tr">{{ tr('errors.' + code) }}</p>
            }
            @if (items().length) {
              <ul class="items">
                @for (i of items(); track $index; let idx = $index) {
                  <li>
                    <mat-checkbox [checked]="!skipped().has(idx)" (change)="toggle(idx, $event.checked)">
                      <strong>{{ i.ingredient ? (i.ingredient | localized: lang()) : i.name }}</strong>
                      @if (label(i); as l) {
                        <span class="meta">{{ l }}</span>
                      }
                      @if (!i.ingredient) {
                        <span class="meta">{{ t('custom') }}</span>
                      }
                      @if (i.note) {
                        <span class="meta">{{ i.note }}</span>
                      }
                    </mat-checkbox>
                  </li>
                }
              </ul>
              <button
                mat-flat-button
                class="ck-cta"
                type="button"
                (click)="add()"
                [disabled]="busy() || !count()"
              >
                {{ t('add', { count: count() }) }}
              </button>
            }
          </section>
        }
      </ng-container>
    }
  `,
  styles: `
    .toggle .material-symbols-rounded {
      margin-right: 6px;
    }
    .dictation {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--ck-border);
      h3 {
        margin: 0 0 8px;
        font-size: 1rem;
      }
      mat-form-field {
        width: 100%;
      }
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
      .material-symbols-rounded {
        margin-right: 4px;
      }
    }
    .hint {
      margin: 6px 0 0;
      font-size: 0.8rem;
      color: var(--ck-text-muted);
    }
    .alert {
      padding: 10px 12px;
      border-radius: var(--ck-radius-sm);
      background: color-mix(in srgb, var(--ck-danger) 12%, transparent);
      color: var(--ck-danger);
    }
    .items {
      margin: 12px 0;
      padding: 0;
      list-style: none;
      .meta {
        margin-left: 8px;
        font-size: 0.85rem;
        color: var(--ck-text-muted);
      }
    }
  `,
})
export class ShoppingDictation {
  private readonly api = inject(AssistantApi);
  private readonly shopping = inject(ShoppingApi);
  private readonly amountLabel = new AmountLabelPipe();
  protected readonly store = inject(AssistantStore);
  protected readonly lang = inject(LanguageService).current;

  /** Pozycje dodane - lista zakupów się przeładowuje */
  readonly added = output<number>();

  protected readonly open = signal(false);
  protected readonly text = signal('');
  protected readonly items = signal<ParsedItem[]>([]);
  protected readonly skipped = signal<ReadonlySet<number>>(new Set());
  protected readonly busy = signal(false);
  protected readonly listening = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Rozpoznawanie mowy wykonuje przeglądarka (bez niej - tylko wpisany tekst) */
  protected readonly speech: (new () => Recognition) | null =
    ((globalThis as Record<string, unknown>)['SpeechRecognition'] as new () => Recognition) ??
    ((globalThis as Record<string, unknown>)['webkitSpeechRecognition'] as new () => Recognition) ??
    null;
  private recognition: Recognition | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.recognition?.stop());
  }

  protected listen(): void {
    if (!this.speech) return;
    const r = new this.speech();
    r.lang = this.lang() === 'en' ? 'en-GB' : 'pl-PL';
    r.interimResults = false;
    r.continuous = true;
    r.onresult = (e) => {
      let heard = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) heard += e.results[i][0].transcript;
      }
      if (heard) this.text.update((t) => (t ? `${t.trim()}, ${heard.trim()}` : heard.trim()));
    };
    r.onend = () => this.listening.set(false);
    r.onerror = () => this.listening.set(false);
    this.recognition = r;
    this.listening.set(true);
    r.start();
  }

  protected stop(): void {
    this.recognition?.stop();
    this.listening.set(false);
  }

  protected close(): void {
    this.stop();
    this.open.set(false);
    this.items.set([]);
    this.error.set(null);
  }

  protected async parse(): Promise<void> {
    this.stop();
    await this.run(async () => {
      const res = await this.api.parseList(this.text().trim());
      this.items.set(res.items);
      this.skipped.set(new Set());
    });
  }

  protected toggle(index: number, checked: boolean): void {
    this.skipped.update((set) => {
      const next = new Set(set);
      if (checked) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  protected count(): number {
    return this.items().length - this.skipped().size;
  }

  protected label(i: ParsedItem): string {
    if (!i.amount || !i.unit) return '';
    return this.amountLabel.transform(i.amount, i.unit, this.lang());
  }

  protected async add(): Promise<void> {
    const chosen = this.items().filter((_, idx) => !this.skipped().has(idx));
    await this.run(async () => {
      for (const i of chosen) {
        if (i.ingredient) {
          const unit = this.allowedUnit(i);
          await this.shopping.add({
            ingredientId: i.ingredient.id,
            ...(unit && i.amount ? { amount: i.amount, unitCode: unit } : {}),
            note: !unit && i.amount ? this.label(i) || undefined : (i.note ?? undefined),
          });
        } else {
          await this.shopping.add({ name: i.name, note: this.label(i) || i.note || undefined });
        }
      }
      this.added.emit(chosen.length);
      this.text.set('');
      this.items.set([]);
      this.open.set(false);
    });
  }

  /** Jednostka z dyktowania, jeśli pasuje do składnika (te same reguły co na liście zakupów) */
  private allowedUnit(i: ParsedItem): string | null {
    const ing = i.ingredient!;
    if (!i.unit) return null;
    if (i.unit === 'g' || i.unit === 'kg') return i.unit;
    if (i.unit === 'ml' || i.unit === 'l') return ing.density ? i.unit : null;
    return ing.units.some((u) => u.code === i.unit) ? i.unit : null;
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await fn();
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.busy.set(false);
    }
  }
}
