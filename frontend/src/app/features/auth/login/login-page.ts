import { Component, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../../core/api-error';
import { accountBlockOf } from '../../../core/auth/account-block';
import { AuthService } from '../../../core/auth/auth.service';
import { LanguageService } from '../../../core/i18n/language.service';
import { AuthShellComponent } from '../auth-shell';

@Component({
  selector: 'app-login-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatProgressBarModule,
    TranslocoDirective,
    AuthShellComponent,
  ],
  templateUrl: './login-page.html',
  styleUrl: '../auth-forms.scss',
})
export class LoginPage {
  protected readonly auth = inject(AuthService);
  private readonly lang = inject(LanguageService).current;
  private readonly router = inject(Router);

  /** Z query param - dokąd wrócić po zalogowaniu */
  readonly returnUrl = input<string>();

  protected readonly form = inject(NonNullableFormBuilder).group({
    login: ['', [Validators.required]],
    password: ['', [Validators.required]],
  });
  protected readonly visible = signal(false);
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);

  protected formatDate(iso: string): string {
    return new Intl.DateTimeFormat(this.lang(), { dateStyle: 'long', timeStyle: 'short' }).format(
      new Date(iso),
    );
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.pending.set(true);
    this.error.set(null);
    this.auth.blocked.set(null);
    try {
      const { login, password } = this.form.getRawValue();
      await this.auth.login(login, password);
      await this.router.navigateByUrl(safeReturnUrl(this.returnUrl()));
    } catch (err) {
      const block = accountBlockOf(err);
      if (block) this.auth.blocked.set(block);
      else this.error.set(apiErrorCode(err));
      this.form.controls.password.reset();
    } finally {
      this.pending.set(false);
    }
  }
}

/** Tylko ścieżki wewnętrzne - chroni przed open redirect (?returnUrl=https://zly.pl). */
export function safeReturnUrl(url: string | undefined): string {
  return url && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\') ? url : '/';
}
