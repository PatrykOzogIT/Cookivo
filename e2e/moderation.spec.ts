import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createUser, loginUi, TEST_PASSWORD, type TestUser } from './support/users';

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .exclude('.cdk-overlay-container')
    .analyze();
  expect(
    results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) })),
  ).toEqual([]);
}

async function authHeaders(request: APIRequestContext, user: TestUser) {
  const login = await request.post('/api/auth/login', {
    data: { login: user.username, password: TEST_PASSWORD },
  });
  return { Authorization: `Bearer ${(await login.json()).accessToken}` };
}

/** Publiczny przepis autora (przez API) */
async function publicRecipe(request: APIRequestContext, author: TestUser) {
  const headers = await authHeaders(request, author);
  const find = async (q: string) =>
    (await (await request.get('/api/ingredients', { params: { q, pageSize: '1' } })).json()).items[0]
      .id as string;
  const title = `Placki ${Date.now().toString(36)}`;
  const res = await request.post('/api/recipes', {
    headers,
    data: {
      title,
      servings: 2,
      visibility: 'PUBLIC',
      canBeIngredient: false,
      mealTypes: ['BREAKFAST'],
      ingredients: [{ ingredientId: await find('maka pszenna'), amount: 200, unitCode: 'g' }],
      steps: [{ text: 'Wymieszaj i usmaż.' }],
      photoIds: [],
    },
  });
  expect(res.status()).toBe(201);
  return { id: (await res.json()).id as string, title };
}

test.describe('Zgłoszenia i moderacja', () => {
  test('zgłoszenie opinii, decyzja admina i status u zgłaszającego', async ({ page, request, browser }) => {
    const author = await createUser(request, 'autorka');
    const critic = await createUser(request, 'krytyk');
    const reporter = await createUser(request, 'zglasza');
    const admin = await createUser(request, 'szefowa', 'ADMIN');
    const recipe = await publicRecipe(request, author);
    const rate = await request.put(`/api/recipes/${recipe.id}/rating`, {
      headers: await authHeaders(request, critic),
      data: { stars: 1, comment: 'Kup moje tabletki na odchudzanie!' },
    });
    expect(rate.ok()).toBeTruthy();

    // Zgłaszający: przycisk przy opinii, okno z powodem
    await loginUi(page, reporter);
    await page.goto(`/recipes/${recipe.id}`);
    await page.getByRole('button', { name: `Zgłoś opinię użytkownika ${critic.username}` }).click();
    const dialog = page.getByRole('dialog', { name: 'Zgłoś opinię' });
    await dialog.getByRole('radio', { name: 'Spam lub reklama' }).check();
    await dialog.getByRole('button', { name: 'Wyślij zgłoszenie' }).click();
    await expect(dialog.getByText('Dziękujemy, zgłoszenie trafiło do moderacji.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Zamknij' }).click();

    // Ponowne zgłoszenie tej samej treści - czytelny błąd
    await page.getByRole('button', { name: `Zgłoś opinię użytkownika ${critic.username}` }).click();
    await dialog.getByRole('radio', { name: 'Inny powód' }).check();
    await dialog.getByRole('button', { name: 'Wyślij zgłoszenie' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Już zgłosiłeś tę treść');
    await dialog.getByRole('button', { name: 'Anuluj' }).click();

    await page.goto('/settings');
    const mine = page.getByRole('region', { name: 'Moje zgłoszenia' });
    await expect(mine).toContainText(recipe.title);
    await expect(mine).toContainText('W trakcie');

    // Admin (osobna przeglądarka): kolejka zgłoszeń, ukrycie z powodem
    const adminCtx = await browser.newContext(test.info().project.use);
    const adminPage = await adminCtx.newPage();
    await loginUi(adminPage, admin);
    await adminPage.goto('/admin');
    await expect(adminPage.getByRole('heading', { name: 'Panel administracyjny', level: 1 })).toBeVisible();
    const item = adminPage.getByRole('listitem').filter({ hasText: `Opinia ${critic.username}` });
    await expect(item).toContainText('Kup moje tabletki');
    await expectNoA11yViolations(adminPage);
    await item.getByLabel('Powód (zobaczy go autor)').fill('Reklama w opinii');
    await item.getByRole('button', { name: 'Ukryj' }).click();
    await expect(item).toHaveCount(0);

    // Opinia zniknęła dla innych
    await adminPage.goto(`/recipes/${recipe.id}`);
    await expect(adminPage.getByText('Kup moje tabletki')).toHaveCount(0);

    // Zgłaszający widzi decyzję w ustawieniach
    await adminCtx.close();
    await page.reload();
    await expect(page.getByRole('region', { name: 'Moje zgłoszenia' })).toContainText('Uwzględnione');
  });

  test('trzy zgłoszenia ukrywają przepis automatycznie, autor widzi powód', async ({ page, request }) => {
    const author = await createUser(request, 'autor');
    const recipe = await publicRecipe(request, author);
    for (const p of ['zgl_a', 'zgl_b', 'zgl_c']) {
      const u = await createUser(request, p);
      const res = await request.post('/api/reports', {
        headers: await authHeaders(request, u),
        data: { targetType: 'RECIPE', recipeId: recipe.id, reason: 'OFFENSIVE' },
      });
      expect(res.status()).toBe(201);
    }

    // Gość już go nie widzi
    const guest = await request.get(`/api/recipes/${recipe.id}`);
    expect(guest.status()).toBe(404);

    // Autor widzi przepis z wyjaśnieniem i nie ma przy nim przycisku "Zgłoś"
    await loginUi(page, author);
    await page.goto(`/recipes/${recipe.id}`);
    await expect(page.getByText('Ukryty automatycznie po zgłoszeniach użytkowników')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zgłoś' })).toHaveCount(0);
  });
});
