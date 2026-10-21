import { Component, inject, input, output, signal, type OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../../core/api-error';
import { LanguageService } from '../../../core/i18n/language.service';
import { compressImage } from '../../recipes/image-compress';
import { LabelImportApi, type LabelDraft, type LabelStatus } from './label-import.api';

/**
 * "Uzupełnij ze zdjęcia etykiety" w formularzu składnika: 1-2 zdjęcia (tabela wartości, skład)
 * → szkic dla formularza. Zdjęć nie zapisujemy; bez klucza API panel się nie pokazuje.
 */
@Component({
  selector: 'app-label-import-panel',
  imports: [MatButtonModule, MatProgressBarModule, TranslocoDirective],
  template: `
    @if (status(); as s) {
      @if (s.enabled) {
        <section
          class="ck-card box label"
          aria-labelledby="label-title"
          *transloco="let t; prefix: 'ingredients.label'"
        >
          <h2 id="label-title">
            <span class="material-symbols-rounded" aria-hidden="true">document_scanner</span>{{ t('title') }}
          </h2>
          <p class="muted">{{ t('hint', { count: s.maxPhotos }) }}</p>
          <input
            #files
            type="file"
            class="cdk-visually-hidden"
            accept="image/jpeg,image/png,image/webp"
            multiple
            tabindex="-1"
            aria-hidden="true"
            (change)="read(files)"
          />
          <div class="row">
            <button
              mat-stroked-button
              type="button"
              (click)="files.click()"
              [disabled]="busy() || !s.remaining"
            >
              <span class="material-symbols-rounded" aria-hidden="true">photo_camera</span>{{ t('choose') }}
            </button>
            <span class="muted">{{ t('remaining', { count: s.remaining, limit: s.dailyLimit }) }}</span>
          </div>
          <div aria-live="polite">
            @if (busy()) {
              <p>{{ t('working') }}</p>
              <mat-progress-bar mode="indeterminate" [attr.aria-label]="t('working')" />
            }
          </div>
          @if (error(); as code) {
            <div class="alert" role="alert" *transloco="let tr">
              <p>{{ tr('errors.' + code) }}</p>
              @for (w of errorWarnings(); track $index) {
                <p class="small">{{ w }}</p>
              }
            </div>
          }
          <p class="muted small">{{ t('privacy') }}</p>
        </section>
      }
    }
  `,
  // Te same klasy co formularz (.box, .muted, .alert)
  styleUrls: ['./ingredient-form-page.scss'],
  styles: `
    .label {
      margin-bottom: 20px;
    }
    .label h2 {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      margin: 8px 0;
      .material-symbols-rounded {
        margin-right: 6px;
      }
    }
    .alert p {
      margin: 0 0 4px;
    }
  `,
})
export class LabelImportPanel implements OnInit {
  private readonly api = inject(LabelImportApi);
  private readonly lang = inject(LanguageService).current;

  /** Nazwa wpisana już w formularzu (podpowiedź dla odczytu) */
  readonly name = input('');
  readonly draft = output<LabelDraft>();

  protected readonly status = signal<LabelStatus | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly errorWarnings = signal<string[]>([]);

  async ngOnInit(): Promise<void> {
    try {
      this.status.set(await this.api.status());
    } catch {
      this.status.set(null);
    }
  }

  protected async read(input: HTMLInputElement): Promise<void> {
    const max = this.status()?.maxPhotos ?? 2;
    const picked = [...(input.files ?? [])];
    input.value = '';
    if (!picked.length) return;
    this.error.set(null);
    this.errorWarnings.set([]);
    if (picked.length > max) {
      this.error.set('LABEL_TOO_MANY');
      return;
    }
    this.busy.set(true);
    try {
      const blobs = await Promise.all(picked.map((f) => compressImage(f, 2000, 0.85)));
      const draft = await this.api.analyze(blobs, this.lang(), this.name().trim());
      this.status.update((s) => (s ? { ...s, remaining: Math.max(0, s.remaining - 1) } : s));
      this.draft.emit(draft);
    } catch (err) {
      this.error.set(apiErrorCode(err));
      const body = (err as { error?: { warnings?: string[] } }).error;
      this.errorWarnings.set(body?.warnings ?? []);
      // Odczyt, który doszedł do modelu, zużywa limit (także nieudany)
      if (['LABEL_NOT_LABEL', 'IMPORT_FAILED'].includes(apiErrorCode(err))) {
        this.status.update((s) => (s ? { ...s, remaining: Math.max(0, s.remaining - 1) } : s));
      }
    } finally {
      this.busy.set(false);
    }
  }
}
