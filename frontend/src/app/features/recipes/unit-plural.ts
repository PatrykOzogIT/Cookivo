/**
 * Odmiana jednostek przez liczby. Formy są w tłumaczeniach jako "jedna|kilka|wiele"
 * (PL: "łyżka|łyżki|łyżek", EN: "tablespoon|tablespoons|tablespoons").
 *
 * Polski: 1 → forma 1; 2–4 (poza 12–14) → forma 2; reszta → forma 3;
 * ułamki (½, 1,5) zawsze forma 2 ("pół łyżki", "1½ łyżki").
 */
export function pluralIndex(amount: number, lang: string): 0 | 1 | 2 {
  if (lang === 'en') return amount === 1 ? 0 : 1;
  if (!Number.isInteger(amount)) return 1;
  if (amount === 1) return 0;
  const lastTwo = amount % 100;
  const last = amount % 10;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return 1;
  return 2;
}

export function pluralForm(forms: string, amount: number, lang: string): string {
  const parts = forms.split('|');
  return parts[Math.min(pluralIndex(amount, lang), parts.length - 1)] ?? parts[0];
}
