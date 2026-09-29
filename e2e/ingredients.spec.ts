import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createUser, loginUi } from './support/users';

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) })),
  ).toEqual([]);
}

test.describe('Składniki - przeglądanie (gość)', () => {
  test('wyszukiwanie bez polskich znaków i szczegóły z kalkulatorem porcji', async ({ page }) => {
    await page.goto('/ingredients');
    await expect(page.getByRole('heading', { level: 1, name: 'Składniki' })).toBeVisible();

    await page.getByLabel('Szukaj składnika').fill('zoltko');
    await expect(page).toHaveURL(/q=zoltko/);
    await page.getByRole('link', { name: /Żółtko jaja/ }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Żółtko jaja' })).toBeVisible();
    await expect(page).toHaveTitle('Żółtko jaja · Cookivo');
    const table = page.getByRole('table', { name: 'Wartości odżywcze' });
    await expect(table.getByRole('row', { name: /Wartość energetyczna/ })).toBeVisible();
    await expect(page.locator('.allergens li')).toHaveText([/Jaja/]); // alergen

    // Domyślnie 1 sztuka (17 g) - zmieniamy na 3 sztuki
    await page.getByLabel('Ilość').fill('3');
    await expect(table.getByRole('columnheader', { name: /3 × sztuka \(51 g\)/ })).toBeVisible();

    await expectNoA11yViolations(page);
  });

  test('filtry w adresie URL: kategoria i wykluczenie alergenu', async ({ page }) => {
    await page.goto('/ingredients?category=BAKERY&allergens=GLUTEN');
    await expect(page.getByText(/Znaleziono: \d+/)).toBeVisible();
    const cards = page.locator('a.card');
    await expect(cards.first()).toBeVisible();
    await expect(cards.filter({ hasText: 'Gluten' })).toHaveCount(0);
    await expect(cards.filter({ hasText: 'Tortilla kukurydziana' })).toHaveCount(1);
    await expectNoA11yViolations(page);
  });

  test('gość nie widzi przycisku dodawania, a formularz wymaga logowania', async ({ page }) => {
    await page.goto('/ingredients');
    await expect(page.getByRole('link', { name: 'Dodaj składnik' })).toHaveCount(0);
    await page.goto('/ingredients/new');
    await expect(page).toHaveURL(/\/auth\/login\?returnUrl=%2Fingredients%2Fnew/);
  });
});

test.describe('Składniki - dodawanie i akceptacja', () => {
  test('użytkownik dodaje składnik, admin go zatwierdza, staje się publiczny', async ({
    page,
    request,
    browser,
  }) => {
    const author = await createUser(request, 'autor');
    const admin = await createUser(request, 'szef', 'ADMIN');
    const name = `Twaróg testowy ${Date.now().toString(36)}`;

    // --- Autor dodaje składnik ---
    await loginUi(page, author);
    await page.goto('/ingredients/new');
    await expectNoA11yViolations(page);

    await page.getByLabel('Nazwa po polsku').fill(name);
    // Listy wyboru otwieramy z klawiatury - sprawdza też obsługę bez myszy
    await page.getByRole('combobox', { name: 'Kategoria' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: 'Nabiał' }).click();
    await page.getByLabel('Wartość energetyczna').fill('133');
    await page.getByLabel('Tłuszcze', { exact: true }).fill('4,7');
    await page.getByLabel('Węglowodany', { exact: true }).fill('3,7');
    await page.getByLabel('Białko').fill('18,7');
    await page.getByRole('checkbox', { name: 'Mleko (w tym laktoza)' }).check();
    await page.getByRole('button', { name: 'Dodaj jednostkę' }).click();
    await page.getByRole('combobox', { name: 'Jednostka' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: '1 łyżka' }).click();
    await page.getByLabel('Waga').fill('25');
    await page.getByRole('button', { name: 'Zapisz składnik' }).click();

    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByText('Składnik czeka na akceptację administratora')).toBeVisible();
    const url = page.url();

    // --- Inni (gość) go nie widzą ---
    const guest = await browser.newPage();
    await guest.goto(url);
    await expect(guest.getByRole('heading', { name: 'Nie ma takiego składnika' })).toBeVisible();
    await guest.close();

    // --- Admin zatwierdza z kolejki ---
    const adminPage = await browser.newPage();
    await loginUi(adminPage, admin);
    await adminPage.goto('/ingredients?status=PENDING');
    await adminPage.getByRole('link', { name: new RegExp(name) }).click();
    await adminPage.getByRole('button', { name: 'Zatwierdź' }).click();
    await expect(adminPage.getByText('Czeka na akceptację')).toHaveCount(0);
    await adminPage.close();

    // --- Teraz widzi go każdy, a autor nie może już edytować ---
    const guest2 = await browser.newPage();
    await guest2.goto(url);
    await expect(guest2.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(guest2.getByText(`Dodany przez użytkownika ${author.username}.`)).toBeVisible();
    await guest2.close();

    await page.reload();
    await expect(page.getByRole('link', { name: 'Edytuj' })).toHaveCount(0);
  });

  test('formularz pokazuje błędy spójności i akceptuje przecinek', async ({ page, request }) => {
    const author = await createUser(request, 'walid');
    await loginUi(page, author);
    await page.goto('/ingredients/new');

    await page.getByLabel('Węglowodany', { exact: true }).fill('3,7');
    await page.getByLabel('w tym cukry').fill('5');
    await page.getByLabel('Białko').fill('1');
    await expect(page.getByText('Cukry nie mogą być większe niż węglowodany ogółem.')).toBeVisible();

    await page.getByLabel('w tym cukry').fill('3,7');
    await page.getByLabel('Tłuszcze', { exact: true }).fill('abc');
    await page.getByLabel('Tłuszcze', { exact: true }).blur();
    await expect(page.getByText('Podaj liczbę, np. 4,5')).toBeVisible();
  });
});
