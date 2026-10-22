import { inject } from '@angular/core';
import { Router, type CanMatchFn } from '@angular/router';
import type { Role } from './auth.models';
import { AuthService } from './auth.service';

/** Tylko dla zalogowanych. Gość trafia na logowanie z powrotem na żądaną stronę. */
export const authGuard: CanMatchFn = async (_route, segments) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  // Start po przerwie: sesja może się jeszcze przywracać - czekamy na wynik zamiast od razu wylogować
  if (auth.status() === 'unknown') await auth.settled();
  if (auth.isLoggedIn()) return true;
  // Pełny docelowy adres - `segments` przy trasach zagnieżdżonych to tylko ostatni fragment
  const returnUrl =
    router.getCurrentNavigation()?.extractedUrl.toString() ?? '/' + segments.map((s) => s.path).join('/');
  return router.createUrlTree(['/auth/login'], { queryParams: { returnUrl } });
};

/** Strony logowania/rejestracji - zalogowany user nie ma tam czego szukać. */
export const guestGuard: CanMatchFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.status() === 'unknown') await auth.settled();
  return auth.isLoggedIn() ? router.createUrlTree(['/']) : true;
};

export function roleGuard(role: Role): CanMatchFn {
  return async () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (auth.status() === 'unknown') await auth.settled();
    return auth.hasRole(role) ? true : router.createUrlTree(['/']);
  };
}
