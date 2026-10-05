import { NgTemplateOutlet } from '@angular/common';
import { Component, inject, signal, type OnInit } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { apiErrorCode } from '../../core/api-error';
import { AuthService } from '../../core/auth/auth.service';
import { LanguageService, type Language } from '../../core/i18n/language.service';
import { PasswordFieldComponent } from '../auth/password/password-field';
import { MyReportsCard } from '../moderation/my-reports-card';
import { PasswordStrengthService } from '../auth/password/password-strength.service';
import { passwordPolicyValidator } from '../auth/password/password-validators';
import { ProfileApi, type SessionInfo } from './profile.api';

/** Tekst potwierdzający usunięcie konta - chroni przed przypadkowym kliknięciem */
export const DELETE_PHRASE: Record<Language, string> = { pl: 'USUŃ', en: 'DELETE' };

/** Czytelny opis urządzenia z User-Agenta ("Chrome · Windows"); null = nie rozpoznano */
export function describeDevice(ua: string | null): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;
  if (!browser) return null;
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} · ${os}` : browser;
}

@Component({
  selector: 'app-settings-page',
  imports: [
    MyReportsCard,
    NgTemplateOutlet,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    TranslocoDirective,
    PasswordFieldComponent,
  ],
  templateUrl: './settings-page.html',
  styleUrl: './profile-pages.scss',
  styles: `
    .sessions {
      margin: 0;
      padding: 0;
      list-style: none;
      li {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 10px 0;
        border-bottom: 1px solid var(--ck-border);
      }
      small {
        display: block;
        color: var(--ck-text-muted);
      }
      .current {
        color: var(--ck-success);
        font-weight: 700;
      }
    }
    mat-form-field,
    .new-password {
      width: 100%;
      max-width: 420px;
      display: block;
    }
    .danger-zone {
      border-color: color-mix(in srgb, var(--ck-danger) 40%, var(--ck-border));
    }
  `,
})
export class SettingsPage implements OnInit {
  private readonly api = inject(ProfileApi);
  private readonly router = inject(Router);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly strength = inject(PasswordStrengthService);
  protected readonly auth = inject(AuthService);
  protected readonly language = inject(LanguageService);

  protected readonly sessions = signal<SessionInfo[]>([]);
  protected readonly message = signal<{ section: string; key: string; error?: boolean } | null>(null);
  protected readonly busy = signal(false);

  protected readonly passwordForm = this.fb.group({
    currentPassword: this.fb.control('', [Validators.required]),
    newPassword: this.fb.control('', {
      validators: [Validators.required],
      asyncValidators: [passwordPolicyValidator(this.strength)],
    }),
  });
  protected readonly emailForm = this.fb.group({
    newEmail: this.fb.control('', [Validators.required, Validators.email]),
    password: this.fb.control('', [Validators.required]),
  });
  protected readonly deleteForm = this.fb.group({
    password: this.fb.control('', [Validators.required]),
    phrase: this.fb.control('', [Validators.required]),
  });

  protected readonly describe = describeDevice;

  protected formatDate(iso: string): string {
    return new Intl.DateTimeFormat(this.language.current(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  }

  async ngOnInit(): Promise<void> {
    await this.loadSessions();
  }

  protected async setLanguage(lang: Language): Promise<void> {
    this.language.use(lang);
    await this.run('language', async () => {
      await this.api.setLocale(lang);
      return 'settings.saved';
    });
  }

  protected async changePassword(): Promise<void> {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    const { currentPassword, newPassword } = this.passwordForm.getRawValue();
    await this.run('password', async () => {
      await this.api.changePassword(currentPassword, newPassword);
      this.passwordForm.reset();
      await this.loadSessions();
      return 'settings.passwordChanged';
    });
  }

  protected async changeEmail(): Promise<void> {
    if (this.emailForm.invalid) {
      this.emailForm.markAllAsTouched();
      return;
    }
    const { newEmail, password } = this.emailForm.getRawValue();
    await this.run('email', async () => {
      await this.api.changeEmail(newEmail.trim(), password);
      this.emailForm.reset();
      return 'settings.emailSent';
    });
  }

  protected async revoke(id: string): Promise<void> {
    await this.run('sessions', async () => {
      await this.api.revokeSession(id);
      await this.loadSessions();
      return 'settings.sessionRevoked';
    });
  }

  protected async revokeOthers(): Promise<void> {
    await this.run('sessions', async () => {
      await this.api.revokeOtherSessions();
      await this.loadSessions();
      return 'settings.sessionRevoked';
    });
  }

  protected async exportData(): Promise<void> {
    await this.run('export', async () => {
      const blob = await this.api.exportData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cookivo-dane-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      return 'settings.exported';
    });
  }

  protected deletePhrase(): string {
    return DELETE_PHRASE[this.language.current() as Language] ?? DELETE_PHRASE.pl;
  }

  protected async deleteAccount(): Promise<void> {
    const { password, phrase } = this.deleteForm.getRawValue();
    if (this.deleteForm.invalid || phrase.trim().toUpperCase() !== this.deletePhrase()) {
      this.deleteForm.markAllAsTouched();
      this.message.set({ section: 'delete', key: 'settings.deletePhraseMismatch', error: true });
      return;
    }
    await this.run('delete', async () => {
      await this.api.deleteAccount(password);
      this.auth.clearSession();
      await this.router.navigate(['/']);
      return 'settings.deleted';
    });
  }

  private async loadSessions(): Promise<void> {
    this.sessions.set(await this.api.sessions().catch(() => []));
  }

  private async run(section: string, fn: () => Promise<string>): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    try {
      this.message.set({ section, key: await fn() });
    } catch (err) {
      this.message.set({ section, key: `errors.${apiErrorCode(err)}`, error: true });
    } finally {
      this.busy.set(false);
    }
  }
}
