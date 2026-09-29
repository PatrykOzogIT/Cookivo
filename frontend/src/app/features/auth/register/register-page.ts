import { Component, type Signal, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../../core/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { LanguageService } from '../../../core/i18n/language.service';
import { AuthShellComponent } from '../auth-shell';
import { PasswordFieldComponent } from '../password/password-field';
import { PasswordStrengthService } from '../password/password-strength.service';
import { passwordPolicyValidator } from '../password/password-validators';
import { USERNAME_MAX, usernameAvailableValidator, usernameFormatValidator } from './username-validators';

/** Kody błędów backendu przypisane do konkretnych pól formularza. */
const FIELD_ERRORS: Record<string, 'username' | 'email' | 'password'> = {
  USERNAME_TAKEN: 'username',
  USERNAME_FORMAT: 'username',
  USERNAME_RESERVED: 'username',
  USERNAME_OFFENSIVE: 'username',
  EMAIL_INVALID: 'email',
  PASSWORD_LENGTH: 'password',
  PASSWORD_WEAK: 'password',
  PASSWORD_PWNED: 'password',
};

@Component({
  selector: 'app-register-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatCheckboxModule,
    MatProgressBarModule,
    TranslocoDirective,
    AuthShellComponent,
    PasswordFieldComponent,
  ],
  templateUrl: './register-page.html',
  styleUrl: '../auth-forms.scss',
})
export class RegisterPage {
  private readonly auth = inject(AuthService);
  private readonly language = inject(LanguageService);
  private readonly strength = inject(PasswordStrengthService);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly usernameMax = USERNAME_MAX;

  protected readonly form = this.fb.group({
    username: this.fb.control('', {
      validators: [Validators.required, usernameFormatValidator],
      asyncValidators: [usernameAvailableValidator((u) => this.auth.usernameAvailable(u))],
    }),
    email: this.fb.control('', [Validators.required, Validators.email, Validators.maxLength(254)]),
    password: this.fb.control('', {
      validators: [Validators.required],
      asyncValidators: [passwordPolicyValidator(this.strength, () => this.userInputs())],
    }),
    acceptTerms: this.fb.control(false, [Validators.requiredTrue]),
  });

  private readonly values: Signal<Partial<{ username: string; email: string }>> = toSignal(
    this.form.valueChanges,
    { initialValue: {} },
  );
  /** Nazwa i mail - hasło nie powinno ich zawierać */
  protected readonly userInputs: Signal<string[]> = computed(() => {
    const { username = '', email = '' } = this.values();
    return [username, email, email.split('@')[0]];
  });

  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Po sukcesie pokazujemy ekran "sprawdź skrzynkę" */
  protected readonly sentTo = signal<string | null>(null);

  protected async submit(): Promise<void> {
    if (this.form.pending) {
      // Poczekaj na walidatory asynchroniczne (dostępność nazwy, siła hasła)
      await new Promise<void>((resolve) => {
        const sub = this.form.statusChanges.subscribe((s) => {
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
    const { username, email, password, acceptTerms } = this.form.getRawValue();
    try {
      await this.auth.register({
        username: username.trim(),
        email: email.trim(),
        password,
        acceptTerms,
        locale: this.language.current() === 'en' ? 'en' : 'pl',
      });
      this.sentTo.set(email.trim());
    } catch (err) {
      const code = apiErrorCode(err);
      const field = FIELD_ERRORS[code];
      if (field) {
        const control = this.form.controls[field];
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
