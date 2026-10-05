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

/** Publiczny przepis autora (przez API) */
async function publicRecipe(request: APIRequestContext, author: TestUser) {
  const login = await request.post('/api/auth/login', {
    data: { login: author.username, password: TEST_PASSWORD },
  });
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  const find = async (q: string) =>
    (await (await request.get('/api/ingredients', { params: { q, pageSize: '1' } })).json()).items[0]
      .id as string;
  const title = `Naleśniki ${Date.now().toString(36)}`;
  const res = await request.post('/api/recipes', {
    headers,
    data: {
      title,
      servings: 4,
      visibility: 'PUBLIC',
      canBeIngredient: false,
      mealTypes: ['BREAKFAST'],
      ingredients: [
        { ingredientId: await find('maka pszenna'), amount: 250, unitCode: 'g' },
        { ingredientId: await find('jajko'), amount: 2, unitCode: 'PIECE' },
      ],
      steps: [{ text: 'Wymieszaj i usmaż.' }],
      photoIds: [],
    },
  });
  expect(res.status()).toBe(201);
  return { id: (await res.json()).id as string, title };
}

test.describe('Oceny i warianty', () => {
  test('ocena z komentarzem, własna wersja i alternatywy pod oryginałem', async ({ page, request }) => {
    const author = await createUser(request, 'autorka');
    const cook = await createUser(request, 'kucharz');
    const original = await publicRecipe(request, author);
    await loginUi(page, cook);

    await page.goto(`/recipes/${original.id}`);
    await expect(page.getByText('Ten przepis nie ma jeszcze opinii.')).toBeVisible();

    // Ocena: 4 gwiazdki + komentarz
    await page.getByText('Gwiazdki: 4 na 5').click({ force: true });
    await page.getByLabel('Komentarz (opcjonalnie)').fill('Dobre, ale dodałabym szczyptę soli.');
    await page.getByRole('button', { name: 'Oceń' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Dziękujemy za ocenę!' })).toBeVisible();
    await expect(page.getByRole('img', { name: /Ocena 4 na 5, liczba ocen: 1/ }).first()).toBeVisible();
    await expect(page.getByText('Dobre, ale dodałabym szczyptę soli.')).toBeVisible();
    await expectNoA11yViolations(page);

    // Własna wersja: formularz edycji z polem "Co zmieniono?"
    await page.getByRole('button', { name: 'Zrób własną wersję' }).click();
    await expect(page).toHaveURL(/\/recipes\/[^/]+\/edit$/);
    await page.getByLabel('Nazwa przepisu').fill(`${original.title} z solą`);
    await page.getByLabel('Co zmieniono? (opcjonalnie)').fill('szczypta soli w cieście');
    await page.getByRole('radio', { name: 'Wszyscy (publiczny)' }).check();
    await page.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await expect(page.getByText(/Na podstawie:/)).toBeVisible();
    await expect(page.getByText('szczypta soli w cieście')).toBeVisible();

    // Pod oryginałem wariant jest alternatywą
    await page.getByRole('link', { name: original.title, exact: true }).click();
    const alternatives = page.getByRole('region', { name: 'Alternatywy' });
    await expect(
      alternatives.getByRole('link', { name: new RegExp(`${original.title} z solą`) }),
    ).toBeVisible();
    await expect(alternatives).toContainText('szczypta soli w cieście');
  });

  test('gość widzi opinie, ale ocenić może po zalogowaniu', async ({ page, request }) => {
    const author = await createUser(request, 'autor');
    const original = await publicRecipe(request, author);
    await page.goto(`/recipes/${original.id}`);
    await expect(page.getByRole('heading', { name: 'Opinie' })).toBeVisible();
    await expect(page.getByText('aby ocenić przepis.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zrób własną wersję' })).toHaveCount(0);
  });
});
