import { containsProfanity, normalizeForModeration } from '../moderation/profanity.js';

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
/** Litery, cyfry, kropka, podkreślnik, myślnik. Musi zaczynać i kończyć się literą lub cyfrą. */
export const USERNAME_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

/** Nazwy zabronione w całości. */
const RESERVED_EXACT = [
  'root',
  'system',
  'support',
  'pomoc',
  'mod',
  'staff',
  'help',
  'api',
  'null',
  'undefined',
  'security',
  'info',
  'kontakt',
  'contact',
  'noreply',
];
/** Nazwy, które nie mogą też być początkiem (np. "admin_kasia", "cookivo.team"). */
const RESERVED_PREFIX = ['admin', 'moderator', 'cookivo', 'official', 'oficjaln', 'superadmin'];

const EXACT_N = new Set(RESERVED_EXACT.map(normalizeForModeration));
const PREFIX_N = RESERVED_PREFIX.map(normalizeForModeration);

export type UsernameProblem = 'USERNAME_FORMAT' | 'USERNAME_RESERVED' | 'USERNAME_OFFENSIVE';

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function checkUsername(username: string): UsernameProblem | null {
  const value = username.trim();
  if (
    value.length < USERNAME_MIN ||
    value.length > USERNAME_MAX ||
    !USERNAME_PATTERN.test(value) ||
    /[._-]{2}/.test(value)
  ) {
    return 'USERNAME_FORMAT';
  }
  const normalized = normalizeForModeration(value);
  if (EXACT_N.has(normalized) || PREFIX_N.some((p) => normalized.startsWith(p))) {
    return 'USERNAME_RESERVED';
  }
  if (containsProfanity(value)) return 'USERNAME_OFFENSIVE';
  return null;
}
