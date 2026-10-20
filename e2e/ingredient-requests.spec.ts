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

test.describe('Prośby o składniki', () => {
  test('admin widzi prośbę, link do formularza z nazwą i wskazuje istniejący składnik', async ({
    page,
    request,
  }) => {
    const user = await createUser(request, 'prosi');
    const login = await request.post('/api/auth/login', {
      data: { login: user.username, password: TEST_PASSWORD },
    });
    const name = `Buraczki tarte ${Date.now().toString(36)}`;
    const created = await request.post('/api/ingredient-requests', {
      headers: { Authorization: `Bearer ${(await login.json()).accessToken}` },
      data: { name },
    });
    expect(created.status()).toBe(201);

    const admin = await createUser(request, 'rozpatruje', 'ADMIN');
    await loginUi(page, admin);
    await page.goto('/admin');
    await page.getByRole('tab', { name: /Prośby o składniki \(\d+\)/ }).click();
    const item = page.getByRole('listitem').filter({ hasText: name });
    await expect(item).toContainText(`zgłasza: ${user.username}`);
    await expect(item.getByRole('link', { name: 'Dodaj składnik' })).toHaveAttribute(
      'href',
      `/ingredients/new?name=${encodeURIComponent(name).replace(/%20/g, '%20')}`,
    );
    await expectNoA11yViolations(page);

    await item.getByRole('button', { name: 'Wskaż istniejący' }).click();
    await item.getByRole('combobox', { name: 'Wskaż składnik z bazy' }).fill('burak');
    await page.getByRole('option', { name: /^.*Burak$/ }).click();
    await expect(page.getByRole('listitem').filter({ hasText: name })).toHaveCount(0);

    await page.getByRole('radio', { name: 'Dodane' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: name })).toContainText('Składnik: Burak');
  });

  test('formularz składnika wypełnia nazwę z prośby', async ({ page, request }) => {
    const admin = await createUser(request, 'formularz', 'ADMIN');
    await loginUi(page, admin);
    await page.goto('/ingredients/new?name=Twaróg%20sernikowy');
    await expect(page.getByLabel('Nazwa po polsku')).toHaveValue('Twaróg sernikowy');
  });
});
