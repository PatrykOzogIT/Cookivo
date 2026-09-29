import en from '../../../../public/i18n/en.json';
import pl from '../../../../public/i18n/pl.json';

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

function params(obj: object): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const walk = (o: object, prefix: string) => {
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === 'object') walk(v, `${prefix}${k}.`);
      else out[`${prefix}${k}`] = [...String(v).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
    }
  };
  walk(obj, '');
  return out;
}

describe('Pliki tłumaczeń', () => {
  it('PL i EN mają ten sam zestaw kluczy', () => {
    expect(keys(en).sort()).toEqual(keys(pl).sort());
  });

  it('PL i EN używają tych samych parametrów {{ }}', () => {
    expect(params(en)).toEqual(params(pl));
  });

  it('każdy kod błędu z backendu ma tłumaczenie', () => {
    const backendCodes = [
      'INVALID_CREDENTIALS',
      'USERNAME_TAKEN',
      'USERNAME_FORMAT',
      'USERNAME_RESERVED',
      'USERNAME_OFFENSIVE',
      'EMAIL_INVALID',
      'PASSWORD_LENGTH',
      'PASSWORD_WEAK',
      'PASSWORD_PWNED',
      'TERMS_REQUIRED',
      'TOKEN_INVALID',
      'SESSION_EXPIRED',
      'UNAUTHENTICATED',
      'FORBIDDEN',
    ];
    for (const code of backendCodes) {
      expect(pl.errors, code).toHaveProperty(code);
    }
  });
});
