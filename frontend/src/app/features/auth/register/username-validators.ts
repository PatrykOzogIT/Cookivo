import type { AbstractControl, AsyncValidatorFn, ValidationErrors, ValidatorFn } from '@angular/forms';

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
/** Musi się zgadzać z backendem (username-policy.ts). */
export const USERNAME_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

/** Szybka walidacja formatu po stronie klienta. Wulgaryzmy i zastrzeżone nazwy sprawdza backend. */
export const usernameFormatValidator: ValidatorFn = (control: AbstractControl<string>) => {
  const value = (control.value ?? '').trim();
  if (!value) return null;
  const ok =
    value.length >= USERNAME_MIN &&
    value.length <= USERNAME_MAX &&
    USERNAME_PATTERN.test(value) &&
    !/[._-]{2}/.test(value);
  return ok ? null : { usernameFormat: true };
};

/** Sprawdza dostępność nazwy na serwerze, z opóźnieniem 400 ms od ostatniego znaku. */
export function usernameAvailableValidator(
  check: (username: string) => Promise<{ available: boolean; reason?: string }>,
  delayMs = 400,
): AsyncValidatorFn {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (control: AbstractControl<string>): Promise<ValidationErrors | null> => {
    clearTimeout(timer);
    const value = (control.value ?? '').trim();
    if (!value) return Promise.resolve(null);
    return new Promise((resolve) => {
      timer = setTimeout(async () => {
        try {
          const res = await check(value);
          resolve(res.available ? null : { server: res.reason ?? 'USERNAME_TAKEN' });
        } catch {
          resolve(null); // błąd sieci - ostateczne sprawdzenie i tak zrobi rejestracja
        }
      }, delayMs);
    });
  };
}
