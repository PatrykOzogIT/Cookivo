import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { waitForMailLink } from './support/mailpit';
import { createUser, loginUi, TEST_PASSWORD } from './support/users';

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) })),
  ).toEqual([]);
}

async function fillCalculator(page: Page) {
  await page.getByLabel('Data urodzenia').fill('1990-05-10');
  await page.getByLabel('Wzrost (cm)').fill('170');
  await page.getByLabel('Waga (kg)').fill('65,5');
}

test.describe('Jak to działa (gość)', () => {
  test('kalkulator liczy cel bez logowania i bez zapisu', async ({ page }) => {
    await page.goto('/how-it-works');
    await expect(page.getByRole('heading', { level: 1, name: 'Jak to działa' })).toBeVisible();
    await expect(page.getByText('Uzupełnij dane, a zobaczysz tu swoje cele.')).toBeVisible();

    await fillCalculator(page);
    const card = page.locator('app-targets-card');
    await expect(card.getByText('kcal dziennie')).toBeVisible();
    await expect(card.getByText(/nie porada medyczna/)).toBeVisible();

    // Zmiana celu przelicza wynik na żywo
    const before = await card.locator('.kcal strong').textContent();
    await page.getByRole('radio', { name: /^Redukcja/ }).check();
    await expect(card.locator('.kcal strong')).not.toHaveText(before ?? '');

    await expect(page.getByRole('link', { name: 'Zacznij z nami' })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});

test.describe('Profil, alergie i preferencje', () => {
  test('zgoda RODO, zapis profilu, alergia i preferencja składnika', async ({ page, request }) => {
    const user = await createUser(request, 'profil');
    await loginUi(page, user);

    // Bez zgody nie ma formularza
    await page.goto('/profile');
    await expect(
      page.getByRole('heading', { name: 'Zgoda na przetwarzanie danych o zdrowiu' }),
    ).toBeVisible();
    await expect(page.getByLabel('Wzrost (cm)')).toHaveCount(0);
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Wyrażam zgodę' }).click();

    await fillCalculator(page);
    await page.getByRole('radio', { name: /^Łagodna redukcja/ }).check();
    await page.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Zapisano' })).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Waga (kg)')).toHaveValue(/65[,.]5/);
    await expect(page.getByRole('radio', { name: /^Łagodna redukcja/ })).toBeChecked();
    await expectNoA11yViolations(page);

    // Alergia na gluten
    await page.goto('/preferences');
    await page
      .getByRole('radiogroup', { name: 'Gluten', exact: true })
      .getByRole('radio', { name: 'Alergia' })
      .click();
    await page.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Zapisano' })).toBeVisible();
    await expectNoA11yViolations(page);

    // Składnik z glutenem: ostrzeżenie i własna preferencja
    await page.goto('/ingredients?q=maka%20pszenna&forMe=0');
    await page
      .getByRole('link', { name: /Mąka pszenna/ })
      .first()
      .click();
    await expect(page.getByRole('note')).toContainText('Gluten');
    const pref = page.getByRole('radiogroup', { name: 'Twoja preferencja' });
    await pref.getByRole('radio', { name: 'Uwielbiam' }).click();
    await expect(pref.getByRole('radio', { name: 'Uwielbiam' })).toBeChecked();

    // "Dla mnie" (domyślnie włączone) ukrywa składniki z glutenem
    await page.goto('/ingredients?q=maka');
    // Bezglutenowe mąki zostają, pszenna znika
    await expect(page.locator('a.card').filter({ hasText: 'Mąka kukurydziana' })).toBeVisible();
    await expect(page.locator('a.card').filter({ hasText: 'Mąka pszenna' })).toHaveCount(0);

    await page.goto('/preferences');
    await expect(page.getByRole('link', { name: 'Mąka pszenna' })).toBeVisible();

    // Wycofanie zgody usuwa dane zdrowotne
    await page.goto('/profile');
    await page.getByRole('button', { name: 'Wycofaj zgodę i usuń dane' }).click();
    await page
      .getByRole('button', { name: /Wycofaj/ })
      .last()
      .click();
    await expect(page.getByRole('button', { name: 'Wyrażam zgodę' })).toBeVisible();
  });
});

test.describe('Ustawienia konta', () => {
  test('zmiana hasła, urządzenia, zmiana maila, eksport i usunięcie konta', async ({ page, request }) => {
    const user = await createUser(request, 'ustaw');
    await loginUi(page, user);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Ustawienia konta' })).toBeVisible();

    // Bieżące urządzenie jest oznaczone
    await expect(page.getByText('to urządzenie')).toBeVisible();

    // Złe obecne hasło
    const newPassword = 'Pomarancza-Gra-Na-Skrzypcach-77';
    await page.getByLabel('Obecne hasło').fill('zle-haslo-123456');
    await page.getByLabel('Nowe hasło', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Zmień hasło' }).click();
    await expect(page.getByRole('alert')).toContainText('Hasło jest nieprawidłowe');

    await page.getByLabel('Obecne hasło').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Zmień hasło' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Hasło zostało zmienione' })).toBeVisible();
    // Bieżąca sesja przetrwała zmianę hasła
    await page.reload();
    await expect(page.getByText('to urządzenie')).toBeVisible();

    await expectNoA11yViolations(page);

    // Zmiana maila przez link z Mailpita
    const newEmail = user.email.replace('@', '.nowy@');
    await page.getByLabel('Nowy adres e-mail').fill(newEmail);
    await page.getByLabel('Potwierdź hasłem').first().fill(newPassword);
    await page.getByRole('button', { name: 'Zmień e-mail' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'wysłaliśmy' })).toBeVisible();
    const link = await waitForMailLink(newEmail, 'Potwierdź nowy adres');
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Adres e-mail zmieniony' })).toBeVisible();
    await page.goto('/settings');
    await expect(page.getByText(`Obecny adres: ${newEmail}`)).toBeVisible();

    // Eksport danych (RODO)
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Pobierz moje dane' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^cookivo-dane-\d{4}-\d{2}-\d{2}\.json$/);

    // Usunięcie konta: bez frazy nie przejdzie
    const deleteBox = page.locator('section').filter({ hasText: 'Usuń konto na zawsze' });
    await deleteBox.getByLabel('Potwierdź hasłem').fill(newPassword);
    await deleteBox.getByRole('button', { name: 'Usuń konto na zawsze' }).click();
    await expect(deleteBox.getByRole('alert')).toBeVisible();
    await deleteBox.getByLabel(/Wpisz USUŃ/).fill('usuń');
    await deleteBox.getByRole('button', { name: 'Usuń konto na zawsze' }).click();
    await expect(page).toHaveURL('/');

    const res = await request.post('/api/auth/login', {
      data: { login: user.username, password: newPassword },
    });
    expect(res.status()).toBe(401);
  });
});
