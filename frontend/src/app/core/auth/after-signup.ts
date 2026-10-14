import { safeStorage } from '../storage';

/**
 * Dokąd wrócić po rejestracji. Rejestracja kończy się linkiem w mailu (nowa karta, bez query params),
 * więc adres z ?returnUrl zapamiętujemy w przeglądarce do pierwszego logowania.
 */
const KEY = 'ck-after-signup';

/** Tylko ścieżki wewnętrzne - chroni przed open redirect (?returnUrl=https://zly.pl). */
export function safeReturnUrl(url: string | null | undefined): string {
  return url && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\') ? url : '/';
}

export function rememberAfterSignup(url: string | null | undefined): void {
  const safe = safeReturnUrl(url);
  if (safe === '/') safeStorage.remove(KEY);
  else safeStorage.set(KEY, safe);
}

/** Zapamiętany adres albo null */
export function pendingAfterSignup(): string | null {
  const url = safeReturnUrl(safeStorage.get(KEY));
  return url === '/' ? null : url;
}

export function clearAfterSignup(): void {
  safeStorage.remove(KEY);
}
