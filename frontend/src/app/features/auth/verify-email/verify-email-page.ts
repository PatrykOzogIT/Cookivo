import { Component, inject, input, signal, type OnInit } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../../core/api-error';
import { AuthService } from '../../../core/auth/auth.service';
import { AuthShellComponent } from '../auth-shell';

type State = 'verifying' | 'success' | 'invalid' | 'resent';

@Component({
  selector: 'app-verify-email-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    TranslocoDirective,
    AuthShellComponent,
  ],
  templateUrl: './verify-email-page.html',
  styleUrl: '../auth-forms.scss',
})
export class VerifyEmailPage implements OnInit {
  protected readonly auth = inject(AuthService);

  readonly token = input<string>();

  protected readonly state = signal<State>('verifying');
  protected readonly resendForm = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
  });
  protected readonly resendError = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    const token = this.token();
    if (!token) {
      this.state.set('invalid');
      return;
    }
    try {
      await this.auth.verifyEmail(token);
      // Access token ma zapisany status weryfikacji - odświeżamy go
      if (this.auth.isLoggedIn()) await this.auth.refresh();
      this.state.set('success');
    } catch {
      this.state.set('invalid');
    }
  }

  protected async resend(): Promise<void> {
    if (this.resendForm.invalid) {
      this.resendForm.markAllAsTouched();
      return;
    }
    try {
      await this.auth.resendVerification(this.resendForm.getRawValue().email);
      this.state.set('resent');
    } catch (err) {
      this.resendError.set(apiErrorCode(err));
    }
  }
}
