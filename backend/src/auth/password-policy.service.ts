import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as en from '@zxcvbn-ts/language-en';
import * as pl from '@zxcvbn-ts/language-pl';
import type { Env } from '../config/env.js';

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
/** Minimalny wynik zxcvbn (0-4). 3 = "trudne do złamania nawet przy kradzieży bazy". */
export const PASSWORD_MIN_SCORE = 3;

export type PasswordProblem = 'PASSWORD_LENGTH' | 'PASSWORD_WEAK' | 'PASSWORD_PWNED';

@Injectable()
export class PasswordPolicyService {
  private readonly logger = new Logger(PasswordPolicyService.name);
  private readonly zxcvbn = new ZxcvbnFactory({
    graphs: common.adjacencyGraphs,
    dictionary: { ...common.dictionary, ...en.dictionary, ...pl.dictionary },
  });

  constructor(private readonly config: ConfigService<Env, true>) {}

  /**
   * @param userInputs dane usera (nazwa, mail), których hasło nie powinno zawierać
   */
  async check(password: string, userInputs: string[] = []): Promise<PasswordProblem | null> {
    // Celowo liczymy punkty kodowe (nie jednostki UTF-16) - tak samo jak frontend
    // oxlint-disable-next-line typescript/no-misused-spread
    const length = [...password].length;
    if (length < PASSWORD_MIN || length > PASSWORD_MAX) return 'PASSWORD_LENGTH';
    if (this.zxcvbn.check(password, userInputs).score < PASSWORD_MIN_SCORE) return 'PASSWORD_WEAK';
    if (await this.isPwned(password)) return 'PASSWORD_PWNED';
    return null;
  }

  /**
   * HaveIBeenPwned, model k-anonymity: wysyłamy tylko 5 pierwszych znaków SHA-1,
   * samo hasło ani pełny hash nie opuszczają serwera. Przy błędzie sieci przepuszczamy.
   */
  private async isPwned(password: string): Promise<boolean> {
    if (!this.config.get('HIBP_ENABLED', { infer: true })) return false;
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    try {
      const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true' },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return false;
      const body = await res.text();
      return body.split('\n').some((line) => {
        const [hash, count] = line.trim().split(':');
        return hash === suffix && Number(count) > 0;
      });
    } catch (err) {
      this.logger.warn(`HIBP niedostępne: ${(err as Error).message}`);
      return false;
    }
  }
}
