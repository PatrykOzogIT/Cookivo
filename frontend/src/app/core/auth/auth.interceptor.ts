import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { accountBlockOf } from './account-block';
import { AuthService } from './auth.service';

/** Endpointy, przy których 401 nie oznacza wygasłego tokenu. */
const NO_RETRY = ['/api/auth/login', '/api/auth/refresh', '/api/auth/logout'];

/**
 * Dokleja access token do żądań API. Gdy token wygaśnie (401),
 * odświeża go raz i ponawia żądanie.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/')) return next(req);

  const auth = inject(AuthService);
  const router = inject(Router);
  const withToken = () => {
    const token = auth.token;
    return token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  };

  return next(withToken()).pipe(
    catchError((error: unknown) => {
      // Konto zablokowane w trakcie sesji: wylogowanie i strona logowania z powodem
      const block = req.url.startsWith('/api/auth/login') ? null : accountBlockOf(error);
      if (block) {
        auth.blocked.set(block);
        auth.clearSession();
        void router.navigateByUrl('/auth/login');
        return throwError(() => error);
      }
      const canRetry =
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        auth.token !== null &&
        !NO_RETRY.some((url) => req.url.startsWith(url));
      if (!canRetry) return throwError(() => error);

      return from(auth.refresh()).pipe(switchMap((ok) => (ok ? next(withToken()) : throwError(() => error))));
    }),
  );
};
