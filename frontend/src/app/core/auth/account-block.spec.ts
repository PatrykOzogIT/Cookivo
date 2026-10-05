import { HttpErrorResponse } from '@angular/common/http';
import { accountBlockOf } from './account-block';

describe('accountBlockOf', () => {
  const err = (status: number, error: unknown) => new HttpErrorResponse({ status, error });

  it('czyta termin i powód z 403 ACCOUNT_BLOCKED', () => {
    expect(
      accountBlockOf(
        err(403, { code: 'ACCOUNT_BLOCKED', until: '2026-10-12T10:00:00.000Z', reason: 'spam' }),
      ),
    ).toEqual({ until: '2026-10-12T10:00:00.000Z', reason: 'spam' });
    expect(accountBlockOf(err(403, { code: 'ACCOUNT_BLOCKED', until: null, reason: 'x' }))?.until).toBeNull();
  });

  it('inne błędy to nie blokada', () => {
    expect(accountBlockOf(err(403, { code: 'FORBIDDEN' }))).toBeNull();
    expect(accountBlockOf(err(401, { code: 'ACCOUNT_BLOCKED' }))).toBeNull();
    expect(accountBlockOf(new Error('x'))).toBeNull();
  });
});
