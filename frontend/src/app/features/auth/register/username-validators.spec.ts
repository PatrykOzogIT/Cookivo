import { FormControl } from '@angular/forms';
import { usernameAvailableValidator, usernameFormatValidator } from './username-validators';

describe('usernameFormatValidator', () => {
  const check = (value: string) => usernameFormatValidator(new FormControl(value));

  it.each(['kasia', 'Jan_Kowalski', 'chef.anna', 'kuba-92'])('akceptuje "%s"', (v) => {
    expect(check(v)).toBeNull();
  });

  it.each(['ab', '_kasia', 'kasia.', 'ka..sia', 'kasia zosia', 'żaneta', 'a'.repeat(21)])(
    'odrzuca "%s"',
    (v) => {
      expect(check(v)).toEqual({ usernameFormat: true });
    },
  );

  it('pomija puste pole (obsługuje je required)', () => {
    expect(check('')).toBeNull();
  });
});

describe('usernameAvailableValidator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('zgłasza zajętą nazwę kodem z serwera', async () => {
    const validator = usernameAvailableValidator(async () => ({
      available: false,
      reason: 'USERNAME_TAKEN',
    }));
    const result = validator(new FormControl('kasia')) as Promise<unknown>;
    await vi.advanceTimersByTimeAsync(400);
    expect(await result).toEqual({ server: 'USERNAME_TAKEN' });
  });

  it('przepuszcza wolną nazwę', async () => {
    const validator = usernameAvailableValidator(async () => ({ available: true }));
    const result = validator(new FormControl('kasia')) as Promise<unknown>;
    await vi.advanceTimersByTimeAsync(400);
    expect(await result).toBeNull();
  });

  it('czeka, aż user skończy pisać (debounce)', async () => {
    const check = vi.fn(async () => ({ available: true }));
    const validator = usernameAvailableValidator(check);
    void validator(new FormControl('k'));
    void validator(new FormControl('ka'));
    const last = validator(new FormControl('kas')) as Promise<unknown>;
    await vi.advanceTimersByTimeAsync(400);
    await last;
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith('kas');
  });

  it('przy błędzie sieci nie blokuje formularza', async () => {
    const validator = usernameAvailableValidator(async () => {
      throw new Error('offline');
    });
    const result = validator(new FormControl('kasia')) as Promise<unknown>;
    await vi.advanceTimersByTimeAsync(400);
    expect(await result).toBeNull();
  });
});
