import { Component, inject, input, signal, type OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { ReceiptImportApi } from './receipt-import.api';

/** Przycisk "Importuj paragon" (lodówka, cenniki) - widoczny tylko przy włączonej funkcji */
@Component({
  selector: 'app-receipt-import-link',
  imports: [MatButtonModule, RouterLink, TranslocoDirective],
  template: `
    @if (enabled()) {
      <a mat-stroked-button routerLink="/receipt-import" [queryParams]="{ from: from() }" *transloco="let t">
        <span class="material-symbols-rounded" aria-hidden="true">photo_camera</span
        >{{ t('receiptImport.open') }}
      </a>
    }
  `,
  styles: `
    :host:empty {
      display: none;
    }
    a .material-symbols-rounded {
      margin-right: 6px;
    }
  `,
})
export class ReceiptImportLink implements OnInit {
  private readonly api = inject(ReceiptImportApi);
  readonly from = input.required<'pantry' | 'prices'>();
  protected readonly enabled = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      this.enabled.set((await this.api.status()).enabled);
    } catch {
      this.enabled.set(false);
    }
  }
}
