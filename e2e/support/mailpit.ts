const MAILPIT = process.env['MAILPIT_URL'] ?? 'http://localhost:8025';

interface MailSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

/** Czeka na maila do danego adresu i zwraca pierwszy link z jego treści. */
export async function waitForMailLink(to: string, subjectPart: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    const { messages } = (await res.json()) as { messages: MailSummary[] };
    const mail = messages.find((m) => m.Subject.includes(subjectPart));
    if (mail) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${mail.ID}`)).json()) as { Text: string };
      const link = full.Text.match(/https?:\/\/\S+/)?.[0];
      if (link) return new URL(link).pathname + new URL(link).search;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Brak maila "${subjectPart}" do ${to}`);
}
