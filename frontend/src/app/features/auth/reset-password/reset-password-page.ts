import { Component, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../../core/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { AuthShellComponent } from '../auth-shell';
import { PasswordFieldComponent } from '../password/password-field';
import { PasswordStrengthService } from '../password/password-strength.service';
import { passwordPolicyValidator } from '../password/password-validators';

@Component({
  selector: 'app-reset-password-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatProgressBarModule,
    TranslocoDirective,
    AuthShellComponent,
    PasswordFieldComponent,
  ],
  template: `
    <ng-container *transloco="let t">
      @if (done()) {
        <app-auth-shell
          icon="task_alt"
          [heading]="t('auth.reset.doneTitle')"
          [subheading]="t('auth.reset.doneBody')"
        >
          <a mat-flat-button class="ck-cta submit" routerLink="/auth/login">{{
            t('auth.checkEmail.toLogin')
          }}</a>
        </app-auth-shell>
      } @else if (!token()) {
        <app-auth-shell
          icon="link_off"
          [heading]="t('auth.verify.invalidTitle')"
          [subheading]="t('auth.reset.invalid')"
        >
          <a mat-flat-button class="ck-cta submit" routerLink="/auth/forgot-password">{{
            t('auth.reset.requestNew')
          }}</a>
        </app-auth-shell>
      } @else {
        <app-auth-shell
          icon="lock_reset"
          [heading]="t('auth.reset.title')"
          [subheading]="t('auth.reset.subtitle')"
        >
          @if (error(); as code) {
            <div class="alert error" role="alert">
              <span class="material-symbols-rounded" aria-hidden="true">error</span>
              <span>
                {{ t('errors.' + code) }}
                @if (code === 'TOKEN_INVALID') {
                  <a routerLink="/auth/forgot-password">{{ t('auth.reset.requestNew') }}</a>
                }
              </span>
            </div>
          }
          <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <app-password-field [control]="form.controls.password" label="auth.fields.newPassword" />
            <button mat-flat-button class="ck-cta submit" type="submit" [disabled]="pending()">
              {{ t('auth.reset.submit') }}
            </button>
            @if (pending()) {
              <mat-progress-bar mode="indeterminate" [attr.aria-label]="t('common.loading')" />
            }
          </form>
        </app-auth-shell>
      }
    </ng-container>
  `,
  styleUrl: '../auth-forms.scss',
})
export class ResetPasswordPage {
  private readonly auth = inject(AuthService);
  private readonly strength = inject(PasswordStrengthService);

  readonly token = input<string>();

  protected readonly form = inject(NonNullableFormBuilder).group({
    password: [
      '',
      { validators: [Validators.required], asyncValidators: [passwordPolicyValidator(this.strength)] },
    ],
  });
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly done = signal(false);

  protected async submit(): Promise<void> {
    const control = this.form.controls.password;
    if (control.pending) {
      await new Promise<void>((resolve) => {
        const sub = control.statusChanges.subscribe((s) => {
          if (s !== 'PENDING') {
            sub.unsubscribe();
            resolve();
          }
        });
      });
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.pending.set(true);
    this.error.set(null);
    try {
      await this.auth.resetPassword(this.token()!, control.value);
      this.done.set(true);
    } catch (err) {
      const code = apiErrorCode(err);
      if (code.startsWith('PASSWORD_')) {
        control.setErrors({ server: code });
        control.markAsTouched();
      } else {
        this.error.set(code);
      }
    } finally {
      this.pending.set(false);
    }
  }
}
