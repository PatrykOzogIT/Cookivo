import { HttpErrorResponse } from '@angular/common/http';

/**
 * Backend zwraca kody błędów (np. USERNAME_TAKEN), a front tłumaczy je
 * kluczem `errors.<KOD>`. Błędy walidacji DTO przychodzą jako `message: string[]`.
 */
export function apiErrorCode(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return 'UNKNOWN';
  if (error.status === 0) return 'NETWORK';
  if (error.status === 429) return 'TOO_MANY_REQUESTS';

  const body: unknown = error.error;
  if (body && typeof body === 'object') {
    const { code, message } = body as { code?: unknown; message?: unknown };
    if (typeof code === 'string') return code;
    const messages = Array.isArray(message) ? message : [message];
    const known = messages.find((m): m is string => typeof m === 'string' && /^[A-Z_]+$/.test(m));
    if (known) return known;
  }
  return error.status >= 500 ? 'SERVER' : 'UNKNOWN';
}
