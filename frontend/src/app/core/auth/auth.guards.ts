import { inject } from '@angular/core';
import { Router, type CanMatchFn } from '@angular/router';
import type { Role } from './auth.models';
import { AuthService } from './auth.service';

/** Tylko dla zalogowanych. Gość trafia na logowanie z powrotem na żądaną stronę. */
export const authGuard: CanMatchFn = (_route, segments) => {
  const auth = inject(AuthService);
  if (auth.isLoggedIn()) return true;
  const returnUrl = '/' + segments.map((s) => s.path).join('/');
  return inject(Router).createUrlTree(['/auth/login'], { queryParams: { returnUrl } });
};

/** Strony logowania/rejestracji - zalogowany user nie ma tam czego szukać. */
export const guestGuard: CanMatchFn = () => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? inject(Router).createUrlTree(['/']) : true;
};

export function roleGuard(role: Role): CanMatchFn {
  return () => {
    const auth = inject(AuthService);
    return auth.hasRole(role) ? true : inject(Router).createUrlTree(['/']);
  };
}
