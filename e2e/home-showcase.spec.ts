import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { createUser, loginUi, TEST_PASSWORD } from './support/users';

const TABS = ['Przepisy', 'Składniki', 'Planer', 'Zakupy', 'Kalorie', 'Lodówka', 'Budżet', 'Rodzina'];

test.describe('Strona główna: prezentacja funkcji', () => {
  test('gość: zakładki, strzałki, klawiatura i etykiety dostępu', async ({ page }) => {
    await page.goto('/');
    const panel = page.getByRole('tabpanel');
    // Na start wykres kalorii - opcjonalny, po zalogowaniu
    await expect(page.getByRole('tab', { name: 'Kalorie' })).toHaveAttribute('aria-selected', 'true');
    await expect(panel).toContainText('Po zalogowaniu');
    await expect(panel).toContainText('Opcjonalne');
    await expect(panel).toContainText('Menu konta → Profil');

    await page.getByRole('tab', { name: 'Przepisy' }).click();
    await expect(panel).toContainText('Dla wszystkich');
    await expect(panel).not.toContainText('Opcjonalne');
    await expect(panel.getByRole('link', { name: 'Przeglądaj przepisy' })).toHaveAttribute(
      'href',
      '/recipes',
    );

    // Klawiatura: strzałka w prawo → Składniki → Planer, z fokusem na zakładce
    await page.getByRole('tab', { name: 'Przepisy' }).press('ArrowRight');
    await page.getByRole('tab', { name: 'Składniki' }).press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Planer' })).toBeFocused();
    await expect(page.getByRole('tab', { name: 'Planer' })).toHaveAttribute('aria-selected', 'true');
    // Funkcja dla zalogowanych → rejestracja z powrotem do planera
    await expect(panel.getByRole('link', { name: 'Załóż konto i zaplanuj tydzień' })).toHaveAttribute(
      'href',
      '/auth/register?returnUrl=%2Fplanner',
    );

    // Strzałki pod slajdem zawijają: z pierwszego do ostatniego
    await page.getByRole('tab', { name: 'Przepisy' }).click();
    await panel.getByRole('button', { name: 'Poprzednia funkcja' }).click();
    await expect(page.getByRole('tab', { name: 'Rodzina' })).toHaveAttribute('aria-selected', 'true');

    // Ścieżka startu i karty-skróty z etykietami
    await expect(page.getByText('Start w 3 krokach')).toBeVisible();
    await expect(page.getByRole('link', { name: /Ile kosztuje Twój tydzień/ })).toHaveAttribute(
      'href',
      '/auth/register?returnUrl=%2Fprices',
    );
  });

  test('po rejestracji z prezentacji logowanie prowadzi do wybranej funkcji', async ({ page, request }) => {
    const user = await createUser(request, 'powrot');
    // Stan po rejestracji z ?returnUrl=/planner (zapamiętany do pierwszego logowania)
    await page.addInitScript(() => localStorage.setItem('ck-after-signup', '/planner'));
    await page.goto('/auth/login');
    await page.getByLabel('Nazwa użytkownika lub e-mail').fill(user.username);
    await page.getByLabel('Hasło', { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Zaloguj się' }).click();
    await expect(page).toHaveURL('/planner');
  });

  test('zalogowany: bez etykiet dostępu, przyciski prowadzą wprost', async ({ page, request }) => {
    const user = await createUser(request, 'pokaz');
    await loginUi(page, user);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Planer' }).click();
    const panel = page.getByRole('tabpanel');
    await expect(panel).not.toContainText('Po zalogowaniu');
    await expect(panel.getByRole('link', { name: 'Otwórz planer' })).toHaveAttribute('href', '/planner');
    await expect(page.getByText('Start w 3 krokach')).toHaveCount(0);
  });

  // Axe dla każdego slajdu w każdym motywie
  for (const theme of ['fresh', 'citrus', 'midnight', 'apricot', 'cinnamon', 'contrast']) {
    test(`WCAG AA - wszystkie slajdy, motyw ${theme}`, async ({ page }) => {
      test.slow();
      await page.addInitScript((t) => localStorage.setItem('ck-theme', t), theme);
      await page.goto('/');
      for (const name of TABS) {
        await page.getByRole('tab', { name }).click();
        await page.waitForTimeout(900);
        const results = await new AxeBuilder({ page })
          .include('app-feature-showcase')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        expect(
          results.violations.map((v) => ({
            slide: name,
            id: v.id,
            nodes: v.nodes.map((n) => n.target.join(' ')),
          })),
        ).toEqual([]);
      }
    });
  }
});
