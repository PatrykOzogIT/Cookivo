import { expect, test } from '@playwright/test';
import { waitForMailLink } from './support/mailpit';

/** Unikalny użytkownik na każdy test - testy nie zależą od stanu bazy. */
function newUser(prefix: string) {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { username: `${prefix}_${id}`.slice(0, 20), email: `${prefix}.${id}@cookivo.test` };
}

test.describe('Konto', () => {
  test('rejestracja → potwierdzenie maila → logowanie → wylogowanie', async ({
    page,
    isMobile,
    browserName,
  }) => {
    test.skip(
      browserName === 'webkit' && process.platform === 'win32',
      'WebKit na Windowsie nie obsługuje SameSite i crashuje przy View Transitions - ten scenariusz sprawdza CI (Linux)',
    );
    const user = newUser('e2e');

    await page.goto('/auth/register');
    await page.getByLabel('Nazwa użytkownika').fill(user.username);
    await page.getByLabel('E-mail').fill(user.email);
    await expect(page.getByText('Nazwa dostępna')).toBeVisible();

    await page.getByRole('button', { name: 'Wygeneruj mocne hasło' }).click();
    const password = await page.locator('input[autocomplete=new-password]').inputValue();
    expect(password).toHaveLength(20);
    await expect(page.getByText('Siła hasła: bardzo mocne')).toBeVisible();

    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Załóż konto' }).last().click();
    await expect(page.getByRole('heading', { name: 'Sprawdź skrzynkę' })).toBeVisible();

    await page.goto(await waitForMailLink(user.email, 'Potwierdź'));
    await expect(page.getByRole('heading', { name: 'E-mail potwierdzony!' })).toBeVisible();

    // Wejście na chronioną stronę przekierowuje na logowanie i wraca po zalogowaniu
    await page.goto('/planner');
    await expect(page).toHaveURL(/\/auth\/login\?returnUrl=%2Fplanner/);
    await page.getByLabel('Nazwa użytkownika lub e-mail').fill(user.email);
    await page.getByLabel('Hasło', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Zaloguj się' }).click();
    await expect(page).toHaveURL('/planner');
    await expect(page.getByRole('heading', { name: 'Planer' })).toBeVisible();

    // Sesja przetrwa przeładowanie (refresh token w ciasteczku httpOnly)
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Planer' })).toBeVisible();
    const cookies = await page.context().cookies();
    const refresh = cookies.find((c) => c.name === 'cookivo_rt');
    expect(refresh?.httpOnly).toBe(true);
    expect(refresh?.sameSite).toBe('Strict');

    // Wylogowanie
    await page.getByRole('button', { name: new RegExp(`Menu konta ${user.username}`) }).click();
    await page.getByRole('menuitem', { name: 'Wyloguj' }).click();
    await expect(page).toHaveURL('/');
    await page.goto('/planner');
    await expect(page).toHaveURL(/\/auth\/login/);

    if (isMobile) {
      await expect(page.getByRole('navigation', { name: 'Nawigacja główna' }).last()).toBeVisible();
    }
  });

  test('błędne dane logowania pokazują ogólny komunikat', async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByLabel('Nazwa użytkownika lub e-mail').fill('nie_istnieje_' + Date.now());
    await page.getByLabel('Hasło', { exact: true }).fill('ZupelnieZleHaslo123!');
    await page.getByRole('button', { name: 'Zaloguj się' }).click();
    await expect(page.getByRole('alert')).toContainText('Nieprawidłowy login lub hasło');
  });

  test('reset hasła przez link z maila', async ({ page, request }) => {
    const user = newUser('reset');
    const oldPassword = 'Stare-Haslo-Marchewka-2026';
    const newPassword = 'Nowe-Haslo-Pietruszka-2026';

    // Konto zakładamy przez API, żeby skupić test na resecie
    await request.post('/api/auth/register', {
      data: { ...user, password: oldPassword, acceptTerms: true, locale: 'pl' },
    });

    await page.goto('/auth/forgot-password');
    await page.getByLabel('E-mail').fill(user.email);
    await page.getByRole('button', { name: 'Wyślij link' }).click();
    await expect(page.getByRole('heading', { name: 'Sprawdź skrzynkę' })).toBeVisible();

    await page.goto(await waitForMailLink(user.email, 'Reset'));
    await page.getByLabel('Nowe hasło').fill(newPassword);
    await page.getByRole('button', { name: 'Zapisz nowe hasło' }).click();
    await expect(page.getByRole('heading', { name: 'Hasło zmienione' })).toBeVisible();

    await page.goto('/auth/login');
    await page.getByLabel('Nazwa użytkownika lub e-mail').fill(user.username);
    await page.getByLabel('Hasło', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Zaloguj się' }).click();
    await expect(page).toHaveURL('/');
  });
});
