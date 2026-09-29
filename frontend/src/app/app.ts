import { Component, DOCUMENT, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { AuthService } from './core/auth/auth.service';
import { LanguageService } from './core/i18n/language.service';
import { ThemeService } from './core/theme/theme.service';
import { LogoComponent } from './layout/logo';
import { GUEST_BOTTOM_NAV, GUEST_NAV, USER_BOTTOM_NAV, USER_MENU, USER_NAV } from './layout/navigation';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    TranslocoDirective,
    MatButtonModule,
    MatMenuModule,
    MatDividerModule,
    MatTooltipModule,
    LogoComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly language = inject(LanguageService);
  protected readonly theme = inject(ThemeService);
  private readonly document = inject(DOCUMENT);

  protected readonly nav = computed(() => (this.auth.isLoggedIn() ? USER_NAV : GUEST_NAV));
  protected readonly bottomNav = computed(() =>
    this.auth.isLoggedIn() ? USER_BOTTOM_NAV : GUEST_BOTTOM_NAV,
  );
  protected readonly userMenu = USER_MENU;
  protected readonly year = new Date().getFullYear();

  protected readonly themeIcon = computed(
    () => ({ system: 'brightness_auto', light: 'light_mode', dark: 'dark_mode' })[this.theme.preference()],
  );

  protected readonly initials = computed(() => this.auth.user()?.username.slice(0, 2).toUpperCase() ?? '');

  /** Przez <base href="/"> zwykły link "#main" przeładowałby stronę główną - przenosimy fokus ręcznie. */
  protected skipToContent(event: Event): void {
    event.preventDefault();
    this.document.getElementById('main')?.focus();
  }
}
