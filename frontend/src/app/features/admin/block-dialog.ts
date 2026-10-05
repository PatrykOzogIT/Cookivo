import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { TranslocoDirective } from '@jsverse/transloco';
import { LanguageService } from '../../core/i18n/language.service';
import { pluralForm } from '../recipes/unit-plural';
import { apiErrorCode } from '../../core/api-error';
import { AdminUsersApi, type AdminUser } from './admin-users.api';

/** Okresy blokady w dniach; 0 = na stałe */
export const BLOCK_PERIODS = [1, 7, 30, 0] as const;

/** Blokada konta: okres i powód (trafia do maila i na stronę logowania). Wynik: nowa blokada. */
@Component({
  selector: 'app-block-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
    TranslocoDirective,
  ],
  template: `
    <ng-container *transloco="let t">
      <h2 mat-dialog-title>{{ t('admin.users.blockTitle', { name: user.username }) }}</h2>
      <mat-dialog-content>
        <fieldset>
          <legend>{{ t('admin.users.period') }}</legend>
          <mat-radio-group [(ngModel)]="days" name="days" class="periods">
            @for (d of periods; track d) {
              <mat-radio-button [value]="d">{{
                d ? d + ' ' + dayForm(t('pantry.dayForms'), d) : t('admin.users.permanent')
              }}</mat-radio-button>
            }
          </mat-radio-group>
        </fieldset>
        <mat-form-field class="full" subscriptSizing="dynamic">
          <mat-label>{{ t('admin.users.reason') }}</mat-label>
          <textarea matInput rows="3" maxlength="500" [(ngModel)]="reason" name="reason" required></textarea>
        </mat-form-field>
        <p class="hint">{{ t('admin.users.blockHint') }}</p>
        @if (error(); as code) {
          <p class="alert" role="alert">{{ t('errors.' + code) }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>{{ t('common.cancel') }}</button>
        <button
          mat-flat-button
          class="danger-fill"
          type="button"
          (click)="save()"
          [disabled]="reason.trim().length < 3 || busy()"
        >
          {{ t('admin.users.block') }}
        </button>
      </mat-dialog-actions>
    </ng-container>
  `,
  styles: `
    fieldset {
      margin: 0 0 12px;
      padding: 0;
      border: 0;
    }
    legend {
      font-weight: 600;
    }
    .periods {
      display: flex;
      flex-direction: column;
    }
    .full {
      width: 100%;
    }
    .hint {
      margin: 6px 0 0;
      font-size: 0.8rem;
      color: var(--ck-text-muted);
    }
    .alert {
      margin: 12px 0 0;
      color: var(--ck-danger);
    }
    .danger-fill:not(:disabled) {
      background: var(--ck-danger);
      color: light-dark(#fff, #1a1512);
    }
  `,
})
export class BlockDialog {
  protected readonly user = inject<AdminUser>(MAT_DIALOG_DATA);
  private readonly api = inject(AdminUsersApi);
  private readonly ref = inject(MatDialogRef<BlockDialog, AdminUser['block']>);

  private readonly lang = inject(LanguageService).current;
  protected readonly periods = BLOCK_PERIODS;
  protected dayForm(forms: string, n: number): string {
    return pluralForm(forms, n, this.lang());
  }
  protected days = 7;
  protected reason = '';
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async save(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const res = await this.api.block(this.user.id, this.days || null, this.reason.trim());
      this.ref.close(res.block);
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.busy.set(false);
    }
  }
}
