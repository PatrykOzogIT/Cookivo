import { Component, inject, input, signal, type OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { AuthService } from '../../core/auth/auth.service';
import { AuthShellComponent } from '../auth/auth-shell';
import { ProfileApi } from './profile.api';

/** Potwierdzenie zmiany adresu e-mail (link z maila wysłanego na NOWY adres). */
@Component({
  selector: 'app-confirm-email-page',
  imports: [RouterLink, MatButtonModule, MatProgressSpinnerModule, TranslocoDirective, AuthShellComponent],
  template: `
    <ng-container *transloco="let t">
      @switch (state()) {
        @case ('pending') {
          <app-auth-shell icon="hourglass_top" [heading]="t('settings.confirmEmail.pending')">
            <mat-spinner diameter="40" [attr.aria-label]="t('common.loading')" />
          </app-auth-shell>
        }
        @case ('success') {
          <app-auth-shell
            icon="mark_email_read"
            [heading]="t('settings.confirmEmail.successTitle')"
            [subheading]="t('settings.confirmEmail.successBody')"
          >
            <a
              mat-flat-button
              class="ck-cta submit"
              [routerLink]="auth.isLoggedIn() ? '/settings' : '/auth/login'"
            >
              {{ t('settings.confirmEmail.continue') }}
            </a>
          </app-auth-shell>
        }
        @case ('invalid') {
          <app-auth-shell
            icon="link_off"
            [heading]="t('settings.confirmEmail.invalidTitle')"
            [subheading]="t('settings.confirmEmail.invalidBody')"
          />
        }
      }
    </ng-container>
  `,
  styleUrl: '../auth/auth-forms.scss',
})
export class ConfirmEmailPage implements OnInit {
  private readonly api = inject(ProfileApi);
  protected readonly auth = inject(AuthService);
  readonly token = input<string>();
  protected readonly state = signal<'pending' | 'success' | 'invalid'>('pending');

  async ngOnInit(): Promise<void> {
    const token = this.token();
    if (!token) {
      this.state.set('invalid');
      return;
    }
    try {
      await this.api.confirmEmailChange(token);
      // Nowy adres ląduje w tokenie dostępu dopiero po odświeżeniu
      if (this.auth.isLoggedIn()) await this.auth.refresh().catch(() => undefined);
      this.state.set('success');
    } catch {
      this.state.set('invalid');
    }
  }
}
