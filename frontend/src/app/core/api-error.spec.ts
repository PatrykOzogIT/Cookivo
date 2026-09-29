import { HttpErrorResponse } from '@angular/common/http';
import { apiErrorCode } from './api-error';

const http = (status: number, error: unknown) => new HttpErrorResponse({ status, error });

describe('apiErrorCode', () => {
  it('zwraca kod z body', () => {
    expect(apiErrorCode(http(409, { code: 'USERNAME_TAKEN' }))).toBe('USERNAME_TAKEN');
  });

  it('wyciąga kod z błędów walidacji DTO', () => {
    expect(apiErrorCode(http(400, { message: ['acceptTerms must be…', 'TERMS_REQUIRED'] }))).toBe(
      'TERMS_REQUIRED',
    );
  });

  it('rozpoznaje brak sieci, limit żądań i błąd serwera', () => {
    expect(apiErrorCode(http(0, null))).toBe('NETWORK');
    expect(apiErrorCode(http(429, null))).toBe('TOO_MANY_REQUESTS');
    expect(apiErrorCode(http(503, 'Service Unavailable'))).toBe('SERVER');
  });

  it('zwraca UNKNOWN dla innych błędów', () => {
    expect(apiErrorCode(new Error('x'))).toBe('UNKNOWN');
    expect(apiErrorCode(http(400, { message: 'coś po angielsku' }))).toBe('UNKNOWN');
  });
});
