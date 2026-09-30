import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { waitForMailLink } from './support/mailpit';
import { createUser, loginUi } from './support/users';

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) })),
  ).toEqual([]);
}

test.describe('Gospodarstwo domowe', () => {
  test('założenie, zaproszenie mailem, dołączenie i opuszczenie', async ({ page, request, browser }) => {
    const anna = await createUser(request, 'anna');
    const bartek = await createUser(request, 'bartek');

    await loginUi(page, anna);
    await page.goto('/household');
    await expect(page.getByRole('heading', { name: 'Załóż gospodarstwo domowe' })).toBeVisible();
    await expectNoA11yViolations(page);

    await page.getByLabel('Nazwa gospodarstwa').fill('Dom testowy');
    await page.getByRole('button', { name: 'Załóż' }).click();
    await expect(page.getByRole('heading', { name: 'Dom testowy' })).toBeVisible();
    await expect(page.getByText('Właściciel')).toBeVisible();

    // Link do skopiowania
    await page.getByRole('button', { name: 'Utwórz link z zaproszeniem' }).click();
    await expect(page.getByLabel('Link z zaproszeniem')).toHaveValue(/\/household\/join\?token=/);

    // Zaproszenie mailem
    await page.getByLabel('Adres e-mail').fill(bartek.email);
    await page.getByRole('button', { name: 'Wyślij zaproszenie' }).click();
    await expect(page.getByRole('status').filter({ hasText: bartek.email })).toBeVisible();
    await expect(page.getByText('Aktywne zaproszenia')).toBeVisible();
    await expectNoA11yViolations(page);

    const link = await waitForMailLink(bartek.email, 'Zaproszenie do wspólnego gotowania');

    // Bartek otwiera link jako gość: podgląd i prośba o zalogowanie
    const ctx = await browser.newContext();
    const bPage = await ctx.newPage();
    await bPage.goto(link);
    await expect(bPage.getByRole('heading', { name: 'Zaproszenie do „Dom testowy”' })).toBeVisible();
    await expect(bPage.getByText(new RegExp(`${anna.username} zaprasza`))).toBeVisible();
    await expectNoA11yViolations(bPage);

    // Logowanie wraca na link, potem dołączenie
    await bPage.locator('#main').getByRole('link', { name: 'Zaloguj' }).click();
    await bPage.getByLabel('Nazwa użytkownika lub e-mail').fill(bartek.username);
    await bPage.getByLabel('Hasło', { exact: true }).fill('Zielony-Kalafior-Tanczy-2026');
    await bPage.getByRole('button', { name: 'Zaloguj się' }).click();
    await expect(bPage).toHaveURL(/\/household\/join\?token=/);
    await bPage.getByRole('button', { name: 'Dołącz' }).click();
    await expect(bPage).toHaveURL(/\/household$/);
    await expect(bPage.getByRole('heading', { name: 'Dom testowy' })).toBeVisible();
    await expect(bPage.getByText(anna.username)).toBeVisible();

    // Domownik nie zaprasza; formularz przepisu ma opcję "Moje gospodarstwo"
    await expect(bPage.getByRole('heading', { name: 'Zaproś domowników' })).toHaveCount(0);
    await bPage.goto('/recipes/new');
    await expect(bPage.getByRole('radio', { name: 'Moje gospodarstwo' })).toBeVisible();

    // Link jest jednorazowy
    await bPage.goto(link);
    await expect(bPage.getByRole('heading', { name: 'Zaproszenie jest nieważne' })).toBeVisible();

    // Anna widzi Bartka i przekazuje mu rolę właściciela, potem odchodzi
    await page.reload();
    await expect(page.getByText(bartek.username)).toBeVisible();
    await page.getByRole('button', { name: 'Przekaż rolę właściciela' }).click();
    await page.getByRole('button', { name: 'Potwierdź' }).click();
    await expect(page.getByRole('heading', { name: 'Zaproś domowników' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Opuść gospodarstwo' }).click();
    await page.getByRole('button', { name: 'Potwierdź' }).click();
    await expect(page.getByRole('heading', { name: 'Załóż gospodarstwo domowe' })).toBeVisible();

    await bPage.goto('/household');
    await expect(bPage.getByText('Właściciel')).toBeVisible();
    await expect(bPage.getByText(anna.username)).toHaveCount(0);
    await ctx.close();
  });

  test('zły link pokazuje komunikat', async ({ page }) => {
    await page.goto('/household/join?token=nieistniejacy-token-123');
    await expect(page.getByRole('heading', { name: 'Zaproszenie jest nieważne' })).toBeVisible();
  });
});
