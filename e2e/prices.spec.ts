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

/** Przepis: 500 g mąki i 4 jajka na 4 porcje */
async function createRecipe(request: APIRequestContext, user: TestUser) {
  const login = await request.post('/api/auth/login', {
    data: { login: user.username, password: TEST_PASSWORD },
  });
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  const find = async (q: string) =>
    (await (await request.get('/api/ingredients', { params: { q, pageSize: '1' } })).json()).items[0]
      .id as string;
  const res = await request.post('/api/recipes', {
    headers,
    data: {
      title: `Placki ${Date.now().toString(36)}`,
      servings: 4,
      visibility: 'PRIVATE',
      canBeIngredient: false,
      mealTypes: [],
      ingredients: [
        { ingredientId: await find('maka pszenna'), amount: 500, unitCode: 'g' },
        { ingredientId: await find('jajko'), amount: 4, unitCode: 'PIECE' },
      ],
      steps: [],
      photoIds: [],
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).id as string;
}

async function addPrice(
  page: Page,
  search: string,
  option: RegExp,
  amount: string,
  unit: string,
  price: string,
) {
  await page.getByRole('combobox', { name: 'Dodaj cenę składnika' }).fill(search);
  await page.getByRole('option', { name: option }).click();
  await page.getByLabel('Opakowanie (ilość)').fill(amount);
  await page.getByRole('combobox', { name: 'Jednostka' }).click();
  await page.getByRole('option', { name: unit, exact: true }).click();
  await page.getByLabel('Cena (PLN)').fill(price);
  await page.getByRole('button', { name: 'Zapisz zmiany' }).click();
}

test.describe('Cenniki i koszty', () => {
  test('cennik za opakowanie, koszt przepisu i porcji', async ({ page, request }) => {
    const user = await createUser(request, 'ceny');
    const recipeId = await createRecipe(request, user);
    await loginUi(page, user);

    // Bez cennika przepis zachęca do założenia
    await page.goto(`/recipes/${recipeId}`);
    await expect(page.getByText('Załóż cennik, aby widzieć koszt przepisu.')).toBeVisible();

    await page.goto('/prices');
    await expect(page.getByRole('heading', { name: 'Załóż pierwszy cennik' })).toBeVisible();
    await page.getByLabel('Nazwa').fill('Osiedlowy');
    await page.getByRole('button', { name: 'Utwórz cennik' }).click();
    await expect(page.getByRole('button', { name: /Osiedlowy.*domyślny/ })).toBeVisible();

    await addPrice(page, 'maka pszenna', /Mąka pszenna$/, '1', 'kg', '4');
    await expect(page.locator('.group li').filter({ hasText: 'Mąka pszenna' })).toContainText('4,00 zł / kg');
    await addPrice(page, 'jajko', /Jajko$/, '10', 'sztuka', '12');
    await expect(page.locator('.group li').filter({ hasText: 'Jajko' })).toContainText('1,20 zł / szt.');
    await expectNoA11yViolations(page);

    // 500 g mąki (2,00 zł) + 4 jajka (4,80 zł) = 6,80 zł, 1,70 zł za porcję
    await page.goto(`/recipes/${recipeId}`);
    await expect(page.getByText(/Koszt ok\. 6,80\s?zł \(1,70\s?zł za porcję\)/)).toBeVisible();
    await page.getByRole('button', { name: 'Więcej porcji' }).click();
    await expect(page.getByText(/Koszt ok\. 8,50\s?zł/)).toBeVisible();

    // Lista zakupów z tego przepisu pokazuje szacowany koszt
    await page.getByRole('button', { name: /Do listy zakupów/ }).click();
    await page.getByRole('link', { name: 'Otwórz listę' }).click();
    await expect(page.getByText(/Szacowany koszt: ok\. 8,50\s?zł \(cennik „Osiedlowy”\)/)).toBeVisible();
  });
});
