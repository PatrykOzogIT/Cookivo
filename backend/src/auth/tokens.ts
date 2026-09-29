import { createHash, randomBytes } from 'node:crypto';

/** Losowy token do linków w mailach i refresh tokenów (256 bitów). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** W bazie trzymamy tylko hash - wyciek bazy nie daje działających tokenów. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
