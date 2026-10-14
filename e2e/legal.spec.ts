import { expect, test } from '@playwright/test';
import { createUser, loginUi, outdateTermsConsent } from './support/users';

test.describe('Dokumenty prawne i zgody', () => {
  test('regulamin i polityka: administrator, kontakt, data obowiązywania', async ({ page }) => {
    await page.goto('/legal/privacy');
    await expect(page.getByRole('heading', { level: 1, name: 'Polityka prywatności' })).toBeVisible();
    await expect(page.getByText('Obowiązuje od 14 października 2026')).toBeVisible();
    await expect(page.getByText(/Administratorem Twoich danych osobowych jest Patryk Ożóg/)).toBeVisible();
    await expect(
      page.locator('article').getByRole('link', { name: 'kontakt@cookivo.pl' }).first(),
    ).toHaveAttribute('href', 'mailto:kontakt@cookivo.pl');

    await page.goto('/legal/terms');
    await expect(page.getByRole('heading', { level: 1, name: 'Regulamin' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Zgłoszenia i moderacja/ })).toBeVisible();
    // Stopka: administrator i kontakt na każdej stronie
    await expect(page.locator('footer').getByText('Administrator danych: Patryk Ożóg')).toBeVisible();
  });

  test('po zmianie regulaminu zalogowany akceptuje nową wersję, historia jest w ustawieniach', async ({
    page,
    request,
  }) => {
    const user = await createUser(request, 'legal');
    await outdateTermsConsent(user);
    await loginUi(page, user);

    const banner = page.getByRole('region', { name: 'Zaktualizowaliśmy dokumenty' });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('link', { name: 'Regulamin' })).toBeVisible();
    await banner.getByRole('button', { name: 'Akceptuję' }).click();
    await expect(banner).toBeHidden();

    await page.goto('/settings');
    const card = page.getByRole('region', { name: 'Moje zgody' });
    await expect(card.getByText('Regulamin')).toHaveCount(2); // stara i nowa wersja
    await expect(card.getByText('wersja 2026-10-14').first()).toBeVisible();
    await expect(card.getByText('Polityka prywatności')).toBeVisible();
  });
});
