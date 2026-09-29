import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../../core/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { AuthShellComponent } from '../auth-shell';

@Component({
  selector: 'app-forgot-password-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    TranslocoDirective,
    AuthShellComponent,
  ],
  template: `
    <ng-container *transloco="let t">
      @if (sentTo(); as email) {
        <app-auth-shell icon="mark_email_unread" [heading]="t('auth.checkEmail.title')">
          <p>{{ t('auth.forgot.sent', { email }) }}</p>
          <a mat-flat-button class="ck-cta submit" routerLink="/auth/login">{{
            t('auth.checkEmail.toLogin')
          }}</a>
        </app-auth-shell>
      } @else {
        <app-auth-shell
          icon="key"
          [heading]="t('auth.forgot.title')"
          [subheading]="t('auth.forgot.subtitle')"
        >
          @if (error(); as code) {
            <div class="alert error" role="alert">
              <span class="material-symbols-rounded" aria-hidden="true">error</span>
              <span>{{ t('errors.' + code) }}</span>
            </div>
          }
          <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <mat-form-field>
              <mat-label>{{ t('auth.fields.email') }}</mat-label>
              <input
                matInput
                type="email"
                inputmode="email"
                formControlName="email"
                autocomplete="email"
                required
              />
              <span matIconPrefix class="material-symbols-rounded prefix" aria-hidden="true">mail</span>
              @if (form.controls.email.hasError('required')) {
                <mat-error>{{ t('validation.required') }}</mat-error>
              } @else if (form.controls.email.invalid) {
                <mat-error>{{ t('errors.EMAIL_INVALID') }}</mat-error>
              }
            </mat-form-field>
            <button mat-flat-button class="ck-cta submit" type="submit" [disabled]="pending()">
              {{ t('auth.forgot.submit') }}
            </button>
            @if (pending()) {
              <mat-progress-bar mode="indeterminate" [attr.aria-label]="t('common.loading')" />
            }
          </form>
          <p class="alt">
            <a routerLink="/auth/login">{{ t('auth.forgot.back') }}</a>
          </p>
        </app-auth-shell>
      }
    </ng-container>
  `,
  styleUrl: '../auth-forms.scss',
})
export class ForgotPasswordPage {
  private readonly auth = inject(AuthService);

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
  });
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly sentTo = signal<string | null>(null);

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.pending.set(true);
    this.error.set(null);
    try {
      const { email } = this.form.getRawValue();
      await this.auth.forgotPassword(email.trim());
      this.sentTo.set(email.trim());
    } catch (err) {
      this.error.set(apiErrorCode(err));
    } finally {
      this.pending.set(false);
    }
  }
}
