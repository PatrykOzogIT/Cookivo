import type { Locale } from '../generated/prisma/enums.js';

export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

interface Copy {
  subject: string;
  heading: string;
  body: string;
  cta?: string;
  footer: string;
}

const COPY = {
  verifyEmail: {
    pl: {
      subject: 'Potwierdź adres e-mail w Cookivo',
      heading: 'Cześć {username}!',
      body: 'Dziękujemy za rejestrację. Kliknij przycisk poniżej, aby potwierdzić adres e-mail. Link jest ważny 24 godziny.',
      cta: 'Potwierdź e-mail',
      footer: 'Jeśli to nie Ty zakładałeś konto, zignoruj tę wiadomość.',
    },
    en: {
      subject: 'Confirm your email for Cookivo',
      heading: 'Hi {username}!',
      body: 'Thanks for signing up. Click the button below to confirm your email address. The link is valid for 24 hours.',
      cta: 'Confirm email',
      footer: "If you didn't create an account, just ignore this email.",
    },
  },
  resetPassword: {
    pl: {
      subject: 'Reset hasła w Cookivo',
      heading: 'Cześć {username}!',
      body: 'Otrzymaliśmy prośbę o zmianę hasła. Kliknij przycisk poniżej, aby ustawić nowe hasło. Link jest ważny 1 godzinę.',
      cta: 'Ustaw nowe hasło',
      footer: 'Jeśli to nie Ty prosiłeś o zmianę, zignoruj tę wiadomość - Twoje hasło pozostanie bez zmian.',
    },
    en: {
      subject: 'Reset your Cookivo password',
      heading: 'Hi {username}!',
      body: 'We received a request to reset your password. Click the button below to choose a new one. The link is valid for 1 hour.',
      cta: 'Set new password',
      footer: "If you didn't request this, ignore this email - your password won't change.",
    },
  },
  accountExists: {
    pl: {
      subject: 'Próba rejestracji w Cookivo',
      heading: 'Cześć {username}!',
      body: 'Ktoś (być może Ty) próbował założyć konto na ten adres e-mail, ale konto już istnieje. Jeśli nie pamiętasz hasła, możesz je zresetować.',
      cta: 'Zresetuj hasło',
      footer: 'Jeśli to nie Ty, zignoruj tę wiadomość.',
    },
    en: {
      subject: 'Sign-up attempt on Cookivo',
      heading: 'Hi {username}!',
      body: 'Someone (maybe you) tried to create an account with this email, but an account already exists. If you forgot your password, you can reset it.',
      cta: 'Reset password',
      footer: "If this wasn't you, ignore this email.",
    },
  },
  changeEmail: {
    pl: {
      subject: 'Potwierdź nowy adres e-mail w Cookivo',
      heading: 'Cześć {username}!',
      body: 'Poproszono o zmianę adresu e-mail konta na ten adres. Kliknij przycisk, aby potwierdzić. Link jest ważny 24 godziny.',
      cta: 'Potwierdź nowy adres',
      footer: 'Jeśli to nie Ty, zignoruj tę wiadomość - adres nie zostanie zmieniony.',
    },
    en: {
      subject: 'Confirm your new Cookivo email',
      heading: 'Hi {username}!',
      body: 'A request was made to change your account email to this address. Click the button to confirm. The link is valid for 24 hours.',
      cta: 'Confirm new email',
      footer: "If this wasn't you, ignore this email - nothing will change.",
    },
  },
  emailChangeRequested: {
    pl: {
      subject: 'Zmiana adresu e-mail w Cookivo',
      heading: 'Cześć {username}!',
      body: 'Ktoś zalogowany na Twoje konto poprosił o zmianę adresu e-mail. Zmiana nastąpi dopiero po potwierdzeniu z nowego adresu.',
      footer: 'Jeśli to nie Ty, natychmiast zmień hasło.',
    },
    en: {
      subject: 'Email change on Cookivo',
      heading: 'Hi {username}!',
      body: 'Someone signed in to your account requested an email change. It only takes effect after confirmation from the new address.',
      footer: "If this wasn't you, change your password right away.",
    },
  },
  passwordChanged: {
    pl: {
      subject: 'Hasło do Cookivo zostało zmienione',
      heading: 'Cześć {username}!',
      body: 'Hasło do Twojego konta zostało właśnie zmienione. Wylogowaliśmy inne urządzenia.',
      footer: 'Jeśli to nie Ty, zresetuj hasło i skontaktuj się z nami.',
    },
    en: {
      subject: 'Your Cookivo password was changed',
      heading: 'Hi {username}!',
      body: 'The password for your account was just changed. We signed out your other devices.',
      footer: "If this wasn't you, reset your password and contact us.",
    },
  },
  contentHidden: {
    pl: {
      subject: 'Twoja treść w Cookivo została ukryta',
      heading: 'Cześć {username}!',
      body: 'Moderator ukrył: „{title}”. Powód: {reason}. Możesz poprawić treść - jeśli uważasz, że to pomyłka, odpowiedz na tę wiadomość.',
      footer: 'Dbamy, żeby Cookivo było miłym miejscem dla wszystkich.',
    },
    en: {
      subject: 'Your content on Cookivo was hidden',
      heading: 'Hi {username}!',
      body: 'A moderator hid: “{title}”. Reason: {reason}. You can edit the content - if you think this is a mistake, reply to this email.',
      footer: 'We keep Cookivo a friendly place for everyone.',
    },
  },
  usernameReset: {
    pl: {
      subject: 'Zmieniliśmy Twoją nazwę w Cookivo',
      heading: 'Cześć!',
      body: 'Po zgłoszeniach innych użytkowników moderator zmienił Twoją nazwę na „{title}”. Powód: {reason}. Logujesz się nową nazwą albo adresem e-mail.',
      footer: 'Dbamy, żeby Cookivo było miłym miejscem dla wszystkich.',
    },
    en: {
      subject: 'We changed your Cookivo username',
      heading: 'Hi!',
      body: 'After reports from other users, a moderator changed your username to “{title}”. Reason: {reason}. Sign in with the new name or your email address.',
      footer: 'We keep Cookivo a friendly place for everyone.',
    },
  },
  accountDeleted: {
    pl: {
      subject: 'Konto w Cookivo zostało usunięte',
      heading: 'Cześć {username}!',
      body: 'Twoje konto i dane osobowe zostały usunięte. Przepisy publiczne zostały zanonimizowane. Dziękujemy za wspólne gotowanie!',
      footer: 'To ostatnia wiadomość od nas.',
    },
    en: {
      subject: 'Your Cookivo account was deleted',
      heading: 'Hi {username}!',
      body: 'Your account and personal data have been deleted. Public recipes were anonymised. Thanks for cooking with us!',
      footer: 'This is the last email from us.',
    },
  },
  householdInvite: {
    pl: {
      subject: 'Zaproszenie do wspólnego gotowania w Cookivo',
      heading: 'Cześć!',
      body: '{inviter} zaprasza Cię do gospodarstwa „{household}” w Cookivo - będziecie razem planować posiłki i zakupy. Link jest ważny 7 dni.',
      cta: 'Dołącz do gospodarstwa',
      footer: 'Jeśli nie znasz tej osoby, zignoruj tę wiadomość.',
    },
    en: {
      subject: 'Invitation to cook together on Cookivo',
      heading: 'Hi!',
      body: '{inviter} invites you to the household “{household}” on Cookivo - you will plan meals and shopping together. The link is valid for 7 days.',
      cta: 'Join the household',
      footer: "If you don't know this person, ignore this email.",
    },
  },
} satisfies Record<string, Record<Locale, Copy>>;

export type MailKind = keyof typeof COPY;

export interface MailVars {
  username: string;
  url?: string;
  /** Zaproszenie do gospodarstwa: kto zaprasza i dokąd */
  inviter?: string;
  household?: string;
  /** Moderacja: czego dotyczy i dlaczego */
  title?: string;
  reason?: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function renderMail(kind: MailKind, locale: Locale, vars: MailVars): MailContent {
  const copy: Copy = COPY[kind][locale];
  const fill = (s: string) =>
    s
      .replaceAll('{username}', vars.username)
      .replaceAll('{inviter}', vars.inviter ?? '')
      .replaceAll('{household}', vars.household ?? '')
      .replaceAll('{title}', vars.title ?? '')
      .replaceAll('{reason}', vars.reason ?? '');
  const heading = fill(copy.heading);

  const text = [heading, '', fill(copy.body), '', vars.url ?? '', '', copy.footer, '', '— Cookivo'].join(
    '\n',
  );

  const button =
    vars.url && copy.cta
      ? `<p style="margin:28px 0"><a href="${escapeHtml(vars.url)}" style="background:linear-gradient(135deg,#F2A65A,#E8704A);color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:600;display:inline-block">${escapeHtml(copy.cta)}</a></p>
         <p style="font-size:13px;color:#6b625b;word-break:break-all">${escapeHtml(vars.url)}</p>`
      : '';

  const html = `<!doctype html><html lang="${locale}"><body style="margin:0;background:#FFF8F1;font-family:Segoe UI,Arial,sans-serif;color:#2E2A26">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <div style="font-size:24px;font-weight:700;color:#E8704A;margin-bottom:24px">Cookivo</div>
    <div style="background:#fff;border-radius:16px;padding:28px;box-shadow:0 4px 20px rgba(46,42,38,.08)">
      <h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(heading)}</h1>
      <p style="line-height:1.6;margin:0">${escapeHtml(fill(copy.body))}</p>
      ${button}
      <p style="font-size:13px;color:#6b625b;margin:0">${escapeHtml(copy.footer)}</p>
    </div>
  </div></body></html>`;

  return { subject: copy.subject, text, html };
}
