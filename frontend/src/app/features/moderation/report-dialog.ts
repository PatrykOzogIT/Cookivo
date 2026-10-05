import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../core/api-error';
import { REPORT_REASONS, ReportsApi, type NewReport, type ReportReason } from './reports.api';

export interface ReportDialogData {
  target: Omit<NewReport, 'reason' | 'details'>;
  /** Co zgłaszamy - do nagłówka, np. tytuł przepisu albo nazwa użytkownika */
  label: string;
}

/** Zgłoszenie treści: powód i opcjonalny opis. Wynik: true = wysłano. */
@Component({
  selector: 'app-report-dialog',
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
      <h2 mat-dialog-title>{{ t('moderation.reportTitle.' + data.target.targetType) }}</h2>
      <mat-dialog-content>
        @if (!sent()) {
          <p class="label">{{ data.label }}</p>
          <fieldset>
            <legend>{{ t('moderation.reason') }}</legend>
            <mat-radio-group [(ngModel)]="reason" name="reason" class="reasons">
              @for (r of reasons; track r) {
                <mat-radio-button [value]="r">{{ t('moderation.reasons.' + r) }}</mat-radio-button>
              }
            </mat-radio-group>
          </fieldset>
          <mat-form-field class="full" subscriptSizing="dynamic">
            <mat-label>{{ t('moderation.details') }}</mat-label>
            <textarea matInput rows="3" maxlength="500" [(ngModel)]="details" name="details"></textarea>
          </mat-form-field>
          <p class="hint">{{ t('moderation.reportHint') }}</p>
          @if (error(); as code) {
            <p class="alert" role="alert">{{ t('errors.' + code) }}</p>
          }
        } @else {
          <p role="status" class="ok">
            <span class="material-symbols-rounded" aria-hidden="true">check_circle</span>
            {{ t(autoHidden() ? 'moderation.sentHidden' : 'moderation.sent') }}
          </p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        @if (!sent()) {
          <button mat-button type="button" mat-dialog-close>{{ t('common.cancel') }}</button>
          <button
            mat-flat-button
            class="ck-cta"
            type="button"
            (click)="send()"
            [disabled]="!reason || busy()"
          >
            {{ t('moderation.send') }}
          </button>
        } @else {
          <button mat-flat-button class="ck-cta" type="button" [mat-dialog-close]="true">
            {{ t('common.close') }}
          </button>
        }
      </mat-dialog-actions>
    </ng-container>
  `,
  styles: `
    .label {
      margin: 0 0 12px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    fieldset {
      margin: 0 0 12px;
      padding: 0;
      border: 0;
    }
    legend {
      font-weight: 600;
    }
    .reasons {
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
    .ok {
      display: flex;
      gap: 8px;
      align-items: center;
      color: var(--ck-success);
      font-weight: 600;
    }
  `,
})
export class ReportDialog {
  protected readonly data = inject<ReportDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(ReportsApi);
  private readonly ref = inject(MatDialogRef<ReportDialog, boolean>);

  protected readonly reasons = REPORT_REASONS;
  protected reason: ReportReason | null = null;
  protected details = '';
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly sent = signal(false);
  protected readonly autoHidden = signal(false);

  protected async send(): Promise<void> {
    if (!this.reason) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const res = await this.api.create({
        ...this.data.target,
        reason: this.reason,
        details: this.details.trim() || undefined,
      });
      this.autoHidden.set(res.autoHidden);
      this.sent.set(true);
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.busy.set(false);
    }
  }

  close(): void {
    this.ref.close(this.sent());
  }
}
