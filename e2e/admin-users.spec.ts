import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createUser, loginUi, TEST_PASSWORD } from './support/users';

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .exclude('.cdk-overlay-container')
    .analyze();
  expect(
    results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) })),
  ).toEqual([]);
}

test.describe('Panel admina: użytkownicy', () => {
  test('blokada czasowa z powodem i komunikat przy logowaniu; nadanie roli admina', async ({
    page,
    request,
    browser,
  }) => {
    const boss = await createUser(request, 'wlasciciel', 'SUPER_ADMIN');
    const spammer = await createUser(request, 'spamer');
    const helper = await createUser(request, 'pomocnik');

    await loginUi(page, boss);
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Użytkownicy' }).click();
    const panel = page.getByRole('tabpanel');

    // Blokada na 7 dni
    await panel.getByLabel('Nazwa lub e-mail').fill(spammer.username);
    await panel.getByRole('button', { name: 'Szukaj' }).click();
    const row = panel.getByRole('listitem').filter({ hasText: spammer.username });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Zablokuj' }).click();
    const dialog = page.getByRole('dialog', { name: `Zablokuj ${spammer.username}` });
    await dialog.getByRole('radio', { name: '7 dni' }).check();
    await dialog.getByLabel('Powód (zobaczy go użytkownik)').fill('Spam w komentarzach');
    await dialog.getByRole('button', { name: 'Zablokuj' }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toContainText('Zablokowany');
    await expect(row).toContainText('Spam w komentarzach');
    await expect(row.getByRole('button', { name: 'Odblokuj' })).toBeVisible();
    await expectNoA11yViolations(page);

    // Rola admina dla innego konta (tylko super admin)
    await panel.getByLabel('Nazwa lub e-mail').fill(helper.username);
    await panel.getByRole('button', { name: 'Szukaj' }).click();
    const helperRow = panel.getByRole('listitem').filter({ hasText: helper.username });
    await helperRow.getByRole('button', { name: 'Nadaj rolę admina' }).click();
    await expect(helperRow.getByRole('button', { name: 'Odbierz rolę admina' })).toBeVisible();
    await expect(helperRow).toContainText('Administrator');

    // Zablokowany próbuje się zalogować
    const ctx = await browser.newContext(test.info().project.use);
    const sPage = await ctx.newPage();
    await sPage.goto('/auth/login');
    await sPage.getByLabel('Nazwa użytkownika lub e-mail').fill(spammer.username);
    await sPage.getByLabel('Hasło', { exact: true }).fill(TEST_PASSWORD);
    await sPage.getByRole('button', { name: 'Zaloguj się' }).click();
    const alert = sPage.getByRole('alert');
    await expect(alert).toContainText('Konto zablokowane do');
    await expect(alert).toContainText('Powód: Spam w komentarzach');
    await expect(sPage).toHaveURL(/\/auth\/login/);
    await expectNoA11yViolations(sPage);
    await ctx.close();
  });

  test('zwykły admin nie widzi przycisków ról', async ({ page, request }) => {
    const admin = await createUser(request, 'szefowa', 'ADMIN');
    const user = await createUser(request, 'kucharz');
    await loginUi(page, admin);
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Użytkownicy' }).click();
    const panel = page.getByRole('tabpanel');
    await panel.getByLabel('Nazwa lub e-mail').fill(user.username);
    await panel.getByRole('button', { name: 'Szukaj' }).click();
    const row = panel.getByRole('listitem').filter({ hasText: user.username });
    await expect(row.getByRole('button', { name: 'Zablokuj' })).toBeVisible();
    await expect(row.getByRole('button', { name: /rolę admina/ })).toHaveCount(0);
  });
});
