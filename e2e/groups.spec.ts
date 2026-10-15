import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
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

/** Przepis "dla grup" przez API */
async function groupRecipe(request: APIRequestContext, author: TestUser, groupId: string, title: string) {
  const headers = await authHeaders(request, author);
  const egg = (
    await (await request.get('/api/ingredients', { params: { q: 'jajko', pageSize: '1' } })).json()
  ).items[0].id as string;
  const res = await request.post('/api/recipes', {
    headers,
    data: {
      title,
      servings: 2,
      visibility: 'GROUPS',
      groupIds: [groupId],
      canBeIngredient: false,
      mealTypes: ['BREAKFAST'],
      ingredients: [{ ingredientId: egg, amount: 3, unitCode: 'PIECE' }],
      steps: [{ text: 'Roztrzep i usmaż.' }],
      photoIds: [],
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).id as string;
}

/** Nowa karta z zalogowaną osobą */
async function sessionFor(browser: Browser, user: TestUser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await loginUi(page, user);
  return page;
}

async function createLink(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Utwórz link z zaproszeniem' }).click();
  const field = page.getByLabel('Link z zaproszeniem');
  await expect(field).toHaveValue(/\/groups\/join\?token=/);
  return field.inputValue();
}

test.describe('Grupy znajomych', () => {
  test('zakładanie, zaproszenia z akceptacją właściciela i przepisy grupy', async ({
    page,
    request,
    browser,
  }) => {
    test.slow();
    const anna = await createUser(request, 'gr_anna');
    const bartek = await createUser(request, 'gr_bartek');
    const cela = await createUser(request, 'gr_cela');
    const name = `Kuchnia ${Date.now().toString(36)}`;

    // Anna zakłada grupę
    await loginUi(page, anna);
    await page.goto('/groups');
    await expect(page.getByRole('heading', { name: 'Nie należysz jeszcze do żadnej grupy' })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByLabel('Nazwa grupy').fill(name);
    await page.getByLabel('Opis (opcjonalnie)').fill('Przepisy na lunch do pracy');
    await page.getByRole('button', { name: 'Załóż grupę' }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    const groupId = page.url().split('/groups/')[1];

    // Link od właściciela: Bartek dołącza od razu
    const ownerLink = await createLink(page);
    await expectNoA11yViolations(page);
    const bPage = await sessionFor(browser, bartek);
    await bPage.goto(ownerLink);
    await expect(bPage.getByRole('heading', { name: `Zaproszenie do grupy „${name}”` })).toBeVisible();
    await expect(bPage.getByText('właściciel grupy musi Cię jeszcze zaakceptować')).toHaveCount(0);
    await bPage.getByRole('button', { name: 'Dołącz do grupy' }).click();
    await expect(bPage.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(bPage.getByRole('link', { name: 'Przepisy grupy' })).toBeVisible();

    // Link od członka: Cela czeka na akceptację
    const memberLink = await createLink(bPage);
    const cPage = await sessionFor(browser, cela);
    await cPage.goto(memberLink);
    await expect(cPage.getByText('właściciel grupy musi Cię jeszcze zaakceptować')).toBeVisible();
    await expectNoA11yViolations(cPage);
    await cPage.getByRole('button', { name: 'Dołącz do grupy' }).click();
    await expect(cPage.getByRole('heading', { name: 'Czekasz na akceptację' })).toBeVisible();
    await expectNoA11yViolations(cPage);

    // Przepis grupy: Bartek widzi, Cela (oczekująca) jeszcze nie
    const title = `Omlet grupowy ${Date.now().toString(36)}`;
    const recipeId = await groupRecipe(request, anna, groupId, title);
    await bPage.goto('/recipes?groups=1');
    await expect(bPage.getByRole('heading', { name: title })).toBeVisible();
    const card = bPage.locator('article, li').filter({ hasText: title }).first();
    await expect(card.getByText(name)).toBeVisible();
    await cPage.goto(`/recipes/${recipeId}`);
    await expect(cPage.getByRole('heading', { level: 1, name: title })).toHaveCount(0);

    // Anna akceptuje Celę
    await page.reload();
    const pending = page.getByRole('region', { name: /Czekają na akceptację/ });
    await expect(pending.getByText(cela.username)).toBeVisible();
    await expect(pending.getByText(`zaprosił(a) ${bartek.username}`)).toBeVisible();
    await expectNoA11yViolations(page);
    await pending.getByRole('button', { name: 'Przyjmij' }).click();
    await expect(page.getByRole('region', { name: 'Członkowie' }).getByText(cela.username)).toBeVisible();

    await cPage.goto(`/recipes/${recipeId}`);
    await expect(cPage.getByRole('heading', { level: 1, name: title })).toBeVisible();

    // Formularz: przepis ma zaznaczoną grupę
    await page.goto(`/recipes/${recipeId}/edit`);
    await expect(page.getByRole('radio', { name: /Dla wybranych grup znajomych/ })).toBeChecked();
    await expect(page.getByRole('checkbox', { name })).toBeChecked();
    await expectNoA11yViolations(page);

    // Lista grup
    await page.goto('/groups');
    await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
    await expect(page.getByText('Osoby: 3')).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
