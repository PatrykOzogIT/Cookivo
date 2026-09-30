import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../config/env.js';
import type { Locale } from '../generated/prisma/enums.js';
import { renderMail, type MailKind, type MailVars } from './mail-templates.js';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService<Env, true>) {
    const user = config.get('SMTP_USER', { infer: true });
    this.transporter = createTransport({
      host: config.get('SMTP_HOST', { infer: true }),
      port: config.get('SMTP_PORT', { infer: true }),
      secure: config.get('SMTP_SECURE', { infer: true }),
      auth: user ? { user, pass: config.get('SMTP_PASS', { infer: true }) } : undefined,
    });
    this.from = config.get('MAIL_FROM', { infer: true });
  }

  async send(to: string, kind: MailKind, locale: Locale, vars: MailVars): Promise<void> {
    const mail = renderMail(kind, locale, vars);
    try {
      await this.transporter.sendMail({ from: this.from, to, ...mail });
    } catch (err) {
      // Nie przerywamy żądania - błąd maila nie może zdradzać, czy konto istnieje.
      this.logger.error(`Nie udało się wysłać maila "${kind}": ${(err as Error).message}`);
    }
  }
}
