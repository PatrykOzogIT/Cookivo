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

/** Przepis "Naleśniki" (mąka, mleko, jajka) i obiad w planie na dany dzień - przez API */
async function setup(request: APIRequestContext, user: TestUser, date: string) {
  const login = await request.post('/api/auth/login', {
    data: { login: user.username, password: TEST_PASSWORD },
  });
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  const find = async (q: string) =>
    (await (await request.get('/api/ingredients', { params: { q, pageSize: '1' } })).json()).items[0]
      .id as string;
  const [flour, milk, egg] = [await find('maka pszenna'), await find('mleko'), await find('jajko')];
  const title = `Naleśniki ${Date.now().toString(36)}`;
  const recipe = await request.post('/api/recipes', {
    headers,
    data: {
      title,
      servings: 4,
      visibility: 'PRIVATE',
      canBeIngredient: false,
      mealTypes: ['BREAKFAST'],
      ingredients: [
        { ingredientId: flour, amount: 250, unitCode: 'g' },
        { ingredientId: milk, amount: 500, unitCode: 'ml' },
        { ingredientId: egg, amount: 2, unitCode: 'PIECE' },
      ],
      steps: [],
      photoIds: [],
    },
  });
  expect(recipe.status()).toBe(201);
  const id = (await recipe.json()).id as string;
  const meal = await request.post('/api/planner/meals', {
    headers,
    data: { date, slot: 'BREAKFAST', recipeId: id, servings: 4 },
  });
  expect(meal.status()).toBe(201);
  return { id, title };
}

const monday = (d = new Date()) => {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

test.describe('Lodówka i lista zakupów', () => {
  test('lodówka, lista z planu minus zapasy, odhaczanie i przeniesienie do lodówki', async ({
    page,
    request,
  }) => {
    const user = await createUser(request, 'zakupy');
    await setup(request, user, monday());
    await loginUi(page, user);

    // W lodówce: mąka "mam" (bez ilości)
    await page.goto('/pantry');
    await expect(page.getByText(/Lodówka jest pusta/)).toBeVisible();
    await page.getByRole('combobox', { name: 'Szukaj składnika' }).fill('maka pszenna');
    await page.getByRole('option', { name: /^.*Mąka pszenna$/ }).click();
    await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
    await expect(page.locator('.group li').filter({ hasText: 'Mąka pszenna' })).toContainText('mam');
    await expectNoA11yViolations(page);

    // Lista z planu bieżącego tygodnia: mąka pominięta
    await page.goto('/shopping');
    await page.getByRole('button', { name: 'Z planu posiłków' }).click();
    await page.getByRole('button', { name: 'Ten tydzień' }).click();
    await page.getByRole('button', { name: 'Dodaj składniki' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Dodano pozycji: 2' })).toContainText(
      'Mąka pszenna',
    );
    await expect(page.getByRole('checkbox', { name: /Mleko/ })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Jajko.*2 szt\./ })).toBeVisible();

    // Własna pozycja
    const picker = page.getByRole('combobox', { name: 'Dodaj składnik albo własną pozycję' });
    await picker.fill('Papier do pieczenia');
    await picker.press('Enter');
    await page.getByLabel('Ilość / opis (opcjonalnie)').fill('1 rolka');
    await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /Papier do pieczenia.*1 rolka/ })).toBeVisible();
    await expectNoA11yViolations(page);

    // Odhaczenie jajek i przeniesienie do lodówki
    await page.getByRole('checkbox', { name: /Jajko/ }).check();
    await expect(page.getByRole('heading', { name: 'W koszyku (1)' })).toBeVisible();
    await page.getByRole('button', { name: 'Przenieś kupione do lodówki' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Przeniesiono do lodówki: 1' })).toBeVisible();

    await page.goto('/pantry');
    await expect(page.locator('.group li').filter({ hasText: 'Jajko' })).toBeVisible();
  });

  test('przepis: składniki na wybraną liczbę porcji trafiają na listę', async ({ page, request }) => {
    const user = await createUser(request, 'przepis');
    const { id } = await setup(request, user, '2026-12-01');
    await loginUi(page, user);

    await page.goto(`/recipes/${id}`);
    await page.getByRole('button', { name: 'Więcej porcji' }).click(); // 4 → 5
    await page.getByRole('button', { name: /Do listy zakupów \(5 porcji\)/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Dodano pozycji: 3' })).toBeVisible();
    await page.getByRole('link', { name: 'Otwórz listę' }).click();
    await expect(page).toHaveURL(/\/shopping$/);
    // 2 jajka na 4 porcje → 2,5 → 3 szt.
    await expect(page.getByRole('checkbox', { name: /Jajko.*3 szt\./ })).toBeVisible();
  });
});
