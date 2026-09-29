import type { AbstractControl, AsyncValidatorFn, ValidationErrors } from '@angular/forms';
import { PASSWORD_MAX, type PasswordStrengthService } from './password-strength.service';

/**
 * Walidator asynchroniczny zgodny z polityką backendu (długość + zxcvbn).
 * Sprawdzenie wycieku (HIBP) robi backend - front nie wysyła haseł na zewnątrz.
 */
export function passwordPolicyValidator(
  strength: PasswordStrengthService,
  userInputs: () => string[] = () => [],
): AsyncValidatorFn {
  return async (control: AbstractControl<string>): Promise<ValidationErrors | null> => {
    const value = control.value ?? '';
    if (!value) return null; // "required" obsługuje osobny walidator
    if ([...value].length > PASSWORD_MAX) return { passwordTooLong: true };
    const result = await strength.evaluate(value, userInputs());
    if (result.tooShort) return { passwordTooShort: true };
    if (!result.acceptable) return { passwordWeak: true };
    return null;
  };
}
