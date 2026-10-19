import { Component, input, model } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

export interface PickedPhoto {
  file: File;
  preview: string;
}

/** Zwalnia podglądy (URL.createObjectURL) - po wysłaniu albo porzuceniu zdjęć */
export function releasePhotos(photos: PickedPhoto[]): void {
  for (const p of photos) URL.revokeObjectURL(p.preview);
}

/**
 * Wybór 1-N zdjęć do odczytu przez AI (przepis, paragon): aparat albo galeria / plik,
 * miniatury z usuwaniem. Teksty z `prefix` (pick, addMore, photoAlt, removePhoto).
 */
@Component({
  selector: 'app-photo-picker',
  imports: [TranslocoDirective],
  template: `
    <ng-container *transloco="let t; prefix: prefix()">
      @if (photos().length) {
        <ul class="thumbs">
          @for (p of photos(); track p.preview; let i = $index) {
            <li>
              <img [src]="p.preview" [alt]="t('photoAlt', { n: i + 1 })" />
              <button
                type="button"
                class="remove"
                (click)="remove(i)"
                [disabled]="disabled()"
                [attr.aria-label]="t('removePhoto', { n: i + 1 })"
              >
                <span class="material-symbols-rounded" aria-hidden="true">close</span>
              </button>
            </li>
          }
        </ul>
      }
      @if (photos().length < max()) {
        <label class="pick" [class.disabled]="disabled()">
          <span class="material-symbols-rounded" aria-hidden="true">add_photo_alternate</span>
          {{ t(photos().length ? 'addMore' : 'pick') }}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            multiple
            [disabled]="disabled()"
            (change)="onFiles($event)"
          />
        </label>
      }
    </ng-container>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;
    }
    .pick {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 44px;
      padding: 0 16px;
      border: 1px solid var(--ck-border-strong);
      border-radius: 999px;
      color: var(--ck-link);
      font-weight: 600;
      cursor: pointer;
      &:focus-within {
        outline: var(--ck-focus-width) solid var(--ck-focus);
        outline-offset: 2px;
      }
      &.disabled {
        opacity: 0.6;
        cursor: default;
      }
      input {
        position: absolute;
        inset: 0;
        opacity: 0;
        cursor: inherit;
      }
    }
    .thumbs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0;
      padding: 10px 10px 0 0;
      list-style: none;
      li {
        position: relative;
      }
      img {
        display: block;
        width: 88px;
        height: 88px;
        object-fit: cover;
        border-radius: var(--ck-radius-sm);
        border: 1px solid var(--ck-border);
      }
    }
    .remove {
      position: absolute;
      top: -10px;
      right: -10px;
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border: 1px solid var(--ck-border);
      border-radius: 50%;
      background: var(--ck-surface);
      color: var(--ck-text);
      cursor: pointer;
      .material-symbols-rounded {
        font-size: 18px;
      }
    }
  `,
})
export class PhotoPicker {
  readonly photos = model<PickedPhoto[]>([]);
  readonly max = input.required<number>();
  readonly disabled = input(false);
  /** Klucze tłumaczeń, np. 'recipes.import' */
  readonly prefix = input.required<string>();

  protected onFiles(event: Event): void {
    const el = event.target as HTMLInputElement;
    const files = [...(el.files ?? [])].filter((f) => f.type.startsWith('image/') || /\.heic$/i.test(f.name));
    el.value = '';
    const added = files.map((file) => ({ file, preview: URL.createObjectURL(file) }));
    const all = [...this.photos(), ...added];
    releasePhotos(all.slice(this.max()));
    this.photos.set(all.slice(0, this.max()));
  }

  protected remove(index: number): void {
    const list = this.photos();
    releasePhotos([list[index]]);
    this.photos.set(list.filter((_, i) => i !== index));
  }
}
