import { Component, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../../core/api-error';
import { MAX_UPLOAD_BYTES, compressImage } from '../image-compress';
import { RecipesApi } from '../recipes.api';
import type { Photo } from '../recipes.models';

let nextId = 0;

/**
 * Wybór zdjęcia: z galerii albo prosto z aparatu (na telefonie).
 * Zdjęcie jest zmniejszane w przeglądarce i od razu wysyłane; rodzic dostaje gotowe `Photo`.
 */
@Component({
  selector: 'app-photo-picker',
  imports: [MatButtonModule, MatProgressBarModule, TranslocoDirective],
  template: `
    <div class="picker" *transloco="let t">
      <input
        #gallery
        class="visually-hidden"
        type="file"
        accept="image/*"
        [multiple]="multiple()"
        [id]="id + '-gallery'"
        (change)="onFiles(gallery)"
        tabindex="-1"
        aria-hidden="true"
      />
      <input
        #camera
        class="visually-hidden"
        type="file"
        accept="image/*"
        capture="environment"
        [id]="id + '-camera'"
        (change)="onFiles(camera)"
        tabindex="-1"
        aria-hidden="true"
      />
      <div class="buttons">
        <button mat-stroked-button type="button" (click)="gallery.click()" [disabled]="busy() || disabled()">
          <span class="material-symbols-rounded" aria-hidden="true">add_photo_alternate</span>
          {{ t(label()) }}
        </button>
        <button
          mat-button
          type="button"
          class="camera"
          (click)="camera.click()"
          [disabled]="busy() || disabled()"
        >
          <span class="material-symbols-rounded" aria-hidden="true">photo_camera</span>
          {{ t('recipes.photos.camera') }}
        </button>
      </div>
      @if (busy()) {
        <mat-progress-bar
          [mode]="progress() === null ? 'indeterminate' : 'determinate'"
          [value]="progress() ?? 0"
          [attr.aria-label]="t('recipes.photos.uploading')"
        />
      }
      @if (error(); as code) {
        <p class="error" role="alert">{{ t('errors.' + code) }}</p>
      }
    </div>
  `,
  styles: `
    .buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      .material-symbols-rounded {
        margin-right: 6px;
      }
    }
    mat-progress-bar {
      margin-top: 8px;
    }
    .error {
      margin: 8px 0 0;
      color: var(--ck-danger);
    }
    /* Aparat ma sens tylko na urządzeniach dotykowych */
    @media (hover: hover) and (pointer: fine) {
      .camera {
        display: none;
      }
    }
  `,
})
export class PhotoPickerComponent {
  private readonly api = inject(RecipesApi);

  readonly multiple = input(false);
  readonly disabled = input(false);
  readonly label = input('recipes.photos.add');
  readonly uploaded = output<Photo>();

  protected readonly id = `ck-photo-${nextId++}`;
  protected readonly busy = signal(false);
  protected readonly progress = signal<number | null>(null);
  protected readonly error = signal<string | null>(null);

  protected async onFiles(inputEl: HTMLInputElement): Promise<void> {
    const files = [...(inputEl.files ?? [])];
    inputEl.value = '';
    if (!files.length) return;
    this.error.set(null);
    this.busy.set(true);
    try {
      for (const file of files) await this.uploadOne(file);
    } finally {
      this.busy.set(false);
      this.progress.set(null);
    }
  }

  private async uploadOne(file: File): Promise<void> {
    let blob: Blob;
    try {
      blob = await compressImage(file);
    } catch {
      this.error.set('PHOTO_INVALID');
      return;
    }
    if (blob.size > MAX_UPLOAD_BYTES) {
      this.error.set('PHOTO_TOO_LARGE');
      return;
    }
    this.progress.set(0);
    await new Promise<void>((resolve) => {
      this.api.uploadPhoto(blob).subscribe({
        next: (e) => {
          if (e.type === 'progress') this.progress.set(e.percent);
          else this.uploaded.emit(e.photo);
        },
        error: (err: unknown) => {
          this.error.set(apiErrorCode(err));
          resolve();
        },
        complete: () => resolve(),
      });
    });
  }
}
