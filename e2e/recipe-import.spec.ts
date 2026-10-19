import AxeBuilder from '@axe-core/playwright';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createUser, loginUi } from './support/users';

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .exclude('.cdk-overlay-container')
    .analyze();
  expect(
    results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) })),
  ).toEqual([]);
}

/** Prawdziwy składnik z bazy w kształcie, który zwraca serwer w szkicu */
async function ingredient(request: APIRequestContext, q: string) {
  const res = await request.get('/api/ingredients', { params: { q, pageSize: '1' } });
  const i = (await res.json()).items[0];
  return { id: i.id, namePl: i.namePl, nameEn: i.nameEn, density: i.density, units: i.units };
}

test.describe('Import przepisu ze zdjęć', () => {
  test('szkic ze zdjęcia wypełnia formularz, oznaczone pozycje da się poprawić i zapisać', async ({
    page,
    request,
  }) => {
    const user = await createUser(request, 'import');
    const egg = await ingredient(request, 'jajko');
    const flour = await ingredient(request, 'maka pszenna');
    const milk = await ingredient(request, 'mleko 3');

    // Serwer bez klucza API ukrywa funkcję - tu podmieniamy odpowiedzi (bez kosztów i sieci)
    await page.route('**/api/recipe-import/status', (route) =>
      route.fulfill({ json: { enabled: true, dailyLimit: 5, remaining: 4, maxPhotos: 3 } }),
    );
    await page.route('**/api/recipe-import', (route) =>
      route.fulfill({
        json: {
          title: 'Naleśniki z zeszytu',
          description: null,
          servings: 2,
          prepMinutes: 5,
          cookMinutes: 15,
          ingredients: [
            line('2 jajka', 'jajko', 2, 'PIECE', egg),
            line('1 szklanka mąki', 'mąka pszenna', 1, 'GLASS', flour),
            { ...line('300 ml mleczka', 'mleczko', 300, 'ml', null), suggestions: [milk] },
          ],
          steps: ['Zmiksuj składniki.', 'Smaż na rozgrzanej patelni.'],
          warnings: ['Ostatni krok lekko rozmazany'],
        },
      }),
    );

    await loginUi(page, user);
    await page.goto('/recipes/new');
    const panel = page.getByRole('region', { name: 'Masz przepis na kartce albo w książce?' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Dziś możesz jeszcze: 4 z 5')).toBeVisible();
    await expectNoA11yViolations(page);

    await panel.locator('input[type=file]').setInputFiles(join(__dirname, 'fixtures', 'dish.jpg'));
    await expect(panel.getByRole('img', { name: 'Zdjęcie przepisu 1' })).toBeVisible();
    await panel.getByRole('button', { name: 'Odczytaj przepis' }).click();

    // Podsumowanie i wypełniony formularz
    await expect(page.getByText('Odczytaliśmy przepis.')).toBeVisible();
    await expect(page.getByText('Sprawdź oznaczone składniki: 1.')).toBeVisible();
    await expect(page.getByText('Ostatni krok lekko rozmazany')).toBeVisible();
    await expect(page.getByLabel('Nazwa przepisu')).toHaveValue('Naleśniki z zeszytu');
    await expect(page.getByLabel('Krok 2', { exact: true })).toHaveValue('Smaż na rozgrzanej patelni.');
    await expectNoA11yViolations(page);

    // Składnik bez dopasowania: podpowiedź z bazy jednym kliknięciem
    await expect(page.getByText('Ze zdjęcia: „300 ml mleczka”')).toBeVisible();
    await page.getByRole('button', { name: milk.namePl }).click();
    await expect(page.getByText('Ze zdjęcia: „300 ml mleczka”')).toHaveCount(0);

    await page.getByRole('button', { name: 'Zapisz przepis' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Naleśniki z zeszytu' })).toBeVisible();
  });

  test('bez włączonego importu panelu nie ma', async ({ page, request }) => {
    const user = await createUser(request, 'import_off');
    await page.route('**/api/recipe-import/status', (route) =>
      route.fulfill({ json: { enabled: false, dailyLimit: 5, remaining: 5, maxPhotos: 3 } }),
    );
    await loginUi(page, user);
    await page.goto('/recipes/new');
    await expect(page.getByRole('heading', { level: 1, name: 'Nowy przepis' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Masz przepis na kartce albo w książce?' })).toHaveCount(0);
  });
});

function line(
  text: string,
  name: string,
  amount: number,
  unitCode: string,
  match: Awaited<ReturnType<typeof ingredient>> | null,
) {
  return {
    text,
    name,
    amount,
    unitCode,
    note: null,
    match,
    suggestions: [],
    uncertain: false,
    unitProblem: false,
  };
}
