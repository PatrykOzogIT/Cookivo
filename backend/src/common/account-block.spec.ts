import { activeBlock } from './account-block.js';

describe('activeBlock', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const at = new Date('2026-10-01T00:00:00Z');

  it('brak blokady', () => {
    expect(activeBlock({ blockedAt: null, blockedUntil: null, blockReason: null }, now)).toBeNull();
  });

  it('blokada stała', () => {
    expect(activeBlock({ blockedAt: at, blockedUntil: null, blockReason: 'spam' }, now)).toEqual({
      until: null,
      reason: 'spam',
    });
  });

  it('blokada czasowa: trwa do terminu, potem wygasa', () => {
    const until = new Date('2026-10-06T00:00:00Z');
    expect(activeBlock({ blockedAt: at, blockedUntil: until, blockReason: 'x' }, now)?.until).toEqual(until);
    expect(activeBlock({ blockedAt: at, blockedUntil: until, blockReason: 'x' }, until)).toBeNull();
  });
});
