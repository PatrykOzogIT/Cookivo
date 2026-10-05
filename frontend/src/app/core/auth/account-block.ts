import { HttpErrorResponse } from '@angular/common/http';

/** Blokada konta przez admina: termin (null = na stałe) i powód */
export interface AccountBlock {
  until: string | null;
  reason: string;
}

/** Odpowiedź 403 ACCOUNT_BLOCKED z backendu albo null */
export function accountBlockOf(error: unknown): AccountBlock | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 403) return null;
  const body = error.error as { code?: unknown; until?: unknown; reason?: unknown } | null;
  if (body?.code !== 'ACCOUNT_BLOCKED') return null;
  return {
    until: typeof body.until === 'string' ? body.until : null,
    reason: typeof body.reason === 'string' ? body.reason : '',
  };
}
