import { Component, inject, output, signal, type OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../../core/api-error';
import { LanguageService } from '../../../core/i18n/language.service';
import { PhotoPicker, releasePhotos, type PickedPhoto } from '../../../shared/photo-picker';
import { compressImage } from '../image-compress';
import { RecipeImportApi, type ImportStatus, type RecipeDraft } from '../recipe-import.api';

/**
 * "Uzupełnij ze zdjęć": 1-3 zdjęcia przepisu → szkic do sprawdzenia w formularzu.
 * Widoczny tylko, gdy serwer ma włączony import (klucz API) - inaczej nic nie pokazujemy.
 */
@Component({
  selector: 'app-recipe-import-panel',
  imports: [MatButtonModule, MatProgressBarModule, TranslocoDirective, PhotoPicker],
  template: `
    @if (status(); as s) {
      @if (s.enabled) {
        <section
          class="ck-card box import"
          aria-labelledby="import-title"
          *transloco="let t; prefix: 'recipes.import'"
        >
          <div class="head">
            <span class="material-symbols-rounded icon" aria-hidden="true">photo_camera</span>
            <div>
              <h2 id="import-title">{{ t('title') }}</h2>
              <p class="muted">{{ t('lead', { max: s.maxPhotos }) }}</p>
            </div>
          </div>

          @if (s.remaining > 0) {
            <app-photo-picker
              class="photos"
              prefix="recipes.import"
              [max]="s.maxPhotos"
              [disabled]="busy()"
              [(photos)]="picked"
              (photosChange)="error.set(null)"
            />
            <div class="row">
              <button
                mat-flat-button
                class="ck-cta"
                type="button"
                (click)="read()"
                [disabled]="!picked().length || busy()"
              >
                <span class="material-symbols-rounded" aria-hidden="true">star_shine</span>{{ t('read') }}
              </button>
            </div>
            <p class="muted small">{{ t('remaining', { count: s.remaining, limit: s.dailyLimit }) }}</p>
          } @else {
            <p class="muted">{{ t('limitReached', { limit: s.dailyLimit }) }}</p>
          }

          <div aria-live="polite">
            @if (busy()) {
              <mat-progress-bar mode="indeterminate" [attr.aria-label]="t('reading')" />
              <p class="muted small">{{ t('reading') }}</p>
            }
          </div>
          @if (error(); as code) {
            <div class="alert" role="alert" *transloco="let tr">
              {{ tr('errors.' + code) }}
              @for (w of errorWarnings(); track $index) {
                <br />{{ w }}
              }
            </div>
          }
          <p class="muted small privacy">{{ t('privacy') }}</p>
        </section>
      }
    }
  `,
  styles: `
    /* Odstęp jak między sekcjami formularza */
    :host {
      display: block;
      margin-bottom: 20px;
    }
    :host:empty {
      display: none;
    }
    .import {
      padding: 16px 20px;
      border-style: dashed;
    }
    .head {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      h2 {
        margin: 0 0 4px;
        font-size: 1.1rem;
      }
      p {
        margin: 0;
      }
    }
    .icon {
      flex-shrink: 0;
      color: var(--ck-link);
      font-size: 28px;
    }
    .muted {
      color: var(--ck-text-muted);
    }
    .small {
      font-size: 0.8rem;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 12px;
    }
    .photos {
      margin-top: 12px;
    }
    .privacy {
      margin: 12px 0 0;
    }
    .alert {
      margin: 12px 0 0;
      padding: 12px 14px;
      border-radius: var(--ck-radius-sm);
      background: color-mix(in srgb, var(--ck-danger) 12%, transparent);
      color: var(--ck-danger);
    }
  `,
})
export class RecipeImportPanel implements OnInit {
  private readonly api = inject(RecipeImportApi);
  private readonly lang = inject(LanguageService).current;

  /** Odczytany szkic przepisu - formularz go wypełnia */
  readonly imported = output<RecipeDraft>();

  protected readonly status = signal<ImportStatus | null>(null);
  protected readonly picked = signal<PickedPhoto[]>([]);
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

  protected async read(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.errorWarnings.set([]);
    try {
      // Mniejsze zdjęcia: szybsza wysyłka i taniej przy odczycie
      const blobs = await Promise.all(this.picked().map((p) => compressImage(p.file, 1600, 0.85)));
      const draft = await this.api.import(blobs, this.lang());
      this.imported.emit(draft);
      releasePhotos(this.picked());
      this.picked.set([]);
    } catch (err) {
      this.error.set(apiErrorCode(err));
      const body = (err as { error?: { warnings?: string[] } }).error;
      this.errorWarnings.set(body?.warnings ?? []);
    } finally {
      this.busy.set(false);
      this.status.set(await this.api.status().catch(() => this.status()));
    }
  }
}
