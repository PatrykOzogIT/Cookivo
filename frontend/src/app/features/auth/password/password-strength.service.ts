import { Injectable } from '@angular/core';
import type { ZxcvbnFactory } from '@zxcvbn-ts/core';

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
/** Musi się zgadzać z backendem (PASSWORD_MIN_SCORE). */
export const PASSWORD_MIN_SCORE = 3;

export interface StrengthResult {
  /** 0-4 */
  score: number;
  /** Czy hasło spełnia politykę (długość + wynik) */
  acceptable: boolean;
  tooShort: boolean;
}

/**
 * Ocena siły hasła (zxcvbn z polskim i angielskim słownikiem).
 * Słowniki ważą kilkaset kB, więc ładujemy je leniwie - dopiero gdy user zacznie pisać hasło.
 */
@Injectable({ providedIn: 'root' })
export class PasswordStrengthService {
  private factory?: Promise<ZxcvbnFactory>;

  async evaluate(password: string, userInputs: string[] = []): Promise<StrengthResult> {
    const length = [...password].length;
    const tooShort = length < PASSWORD_MIN;
    if (!password) return { score: 0, acceptable: false, tooShort };

    const zxcvbn = await this.load();
    const { score } = zxcvbn.check(password.slice(0, PASSWORD_MAX), userInputs.filter(Boolean));
    return {
      score,
      acceptable: !tooShort && length <= PASSWORD_MAX && score >= PASSWORD_MIN_SCORE,
      tooShort,
    };
  }

  private load(): Promise<ZxcvbnFactory> {
    this.factory ??= Promise.all([
      import('@zxcvbn-ts/core'),
      import('@zxcvbn-ts/language-common'),
      import('@zxcvbn-ts/language-en'),
      import('@zxcvbn-ts/language-pl'),
    ]).then(
      ([core, common, en, pl]) =>
        new core.ZxcvbnFactory({
          graphs: common.adjacencyGraphs,
          dictionary: { ...common.dictionary, ...en.dictionary, ...pl.dictionary },
        }),
    );
    return this.factory;
  }
}
