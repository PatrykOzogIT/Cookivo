import { ForbiddenException } from '@nestjs/common';

export interface BlockFields {
  blockedAt: Date | null;
  blockedUntil: Date | null;
  blockReason: string | null;
}

/** Aktywna blokada konta albo null (czasowa po terminie już nie obowiązuje) */
export function activeBlock(u: BlockFields, now = new Date()): { until: Date | null; reason: string } | null {
  if (!u.blockedAt) return null;
  if (u.blockedUntil && u.blockedUntil <= now) return null;
  return { until: u.blockedUntil, reason: u.blockReason ?? '' };
}

/** 403 z terminem i powodem - frontend pokazuje je na stronie logowania */
export function blockedError(block: { until: Date | null; reason: string }): ForbiddenException {
  return new ForbiddenException({
    code: 'ACCOUNT_BLOCKED',
    until: block.until?.toISOString() ?? null,
    reason: block.reason,
  });
}
