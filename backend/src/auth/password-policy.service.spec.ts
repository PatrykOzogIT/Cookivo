import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { PasswordPolicyService } from './password-policy.service.js';

function createService(hibp = false) {
  const config = { get: () => hibp } as unknown as ConfigService<Env, true>;
  return new PasswordPolicyService(config);
}

describe('PasswordPolicyService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('odrzuca za krótkie hasło', async () => {
    expect(await createService().check('Kr0tkie!')).toBe('PASSWORD_LENGTH');
  });

  it('odrzuca za długie hasło', async () => {
    expect(await createService().check('a'.repeat(129))).toBe('PASSWORD_LENGTH');
  });

  it.each(['password1234', 'qwertyuiop12', 'kochamciebie1', 'aaaaaaaaaaaa'])(
    'odrzuca słabe hasło "%s"',
    async (pw) => {
      expect(await createService().check(pw)).toBe('PASSWORD_WEAK');
    },
  );

  it('odrzuca hasło zbudowane z nazwy użytkownika', async () => {
    expect(await createService().check('jankowalski2026', ['jankowalski2026'])).toBe('PASSWORD_WEAK');
  });

  it('akceptuje mocne hasło', async () => {
    expect(await createService().check('Zielony-Kalafior-Tańczy-42')).toBeNull();
  });

  it('odrzuca hasło z wycieku (HIBP), wysyłając tylko prefiks hasha', async () => {
    // SHA-1("Zielony-Kalafior-Tańczy-42") - wyliczamy sufiks w teście, żeby nie trzymać go na sztywno
    const { createHash } = await import('node:crypto');
    const sha1 = createHash('sha1').update('Zielony-Kalafior-Tańczy-42').digest('hex').toUpperCase();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(`0000000000000000000000000000000000A:0\r\n${sha1.slice(5)}:12`));

    expect(await createService(true).check('Zielony-Kalafior-Tańczy-42')).toBe('PASSWORD_PWNED');
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`,
      expect.anything(),
    );
  });

  it('przepuszcza hasło, gdy HIBP jest niedostępne', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await createService(true).check('Zielony-Kalafior-Tańczy-42')).toBeNull();
  });
});
