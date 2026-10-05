import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createUser, loginUi, TEST_PASSWORD, type TestUser } from './support/users';

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    // Okno dialogowe Material ma własne warstwy - sprawdzamy stronę bez nakładek
    .exclude('.cdk-overlay-container')
    .analyze();
  expect(
    results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) })),
  ).toEqual([]);
}

/** Przepis przez API (planer testujemy osobno od formularza przepisu) */
async function createRecipe(request: APIRequestContext, user: TestUser, title: string) {
  const login = await request.post('/api/auth/login', {
    data: { login: user.username, password: TEST_PASSWORD },
  });
  const token = (await login.json()).accessToken as string;
  const search = await request.get('/api/ingredients', { params: { q: 'marchew', pageSize: '1' } });
  const carrot = (await search.json()).items[0].id as string;
  const res = await request.post('/api/recipes', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title,
      servings: 4,
      visibility: 'PRIVATE',
      canBeIngredient: false,
      mealTypes: ['DINNER'],
      ingredients: [{ ingredientId: carrot, amount: 800, unitCode: 'g' }],
      steps: [],
      photoIds: [],
    },
  });
  expect(res.status()).toBe(201);
}

/** Na węższych ekranach planer pokazuje jeden dzień - trzeba go wybrać */
async function showDay(page: Page, label: RegExp) {
  if ((page.viewportSize()?.width ?? 1280) < 1100) {
    await page.locator('.day-tabs').getByRole('button', { name: label }).click();
  }
}

test.describe('Planer', () => {
  test('danie z zapasem, resztki kolejnego dnia, usunięcie i ustawienia', async ({ page, request }) => {
    const user = await createUser(request, 'planer');
    const title = `Zupa marchewkowa ${Date.now().toString(36)}`;
    await createRecipe(request, user, title);
    await loginUi(page, user);

    await page.goto('/planner?week=2026-10-05&day=2026-10-07');
    await expect(page.getByRole('heading', { level: 1, name: 'Planer' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /5.*11 października 2026/ })).toBeVisible();
    await expectNoA11yViolations(page);

    // Środa, obiad: 1 porcja teraz, 2 ugotowane
    await page.getByRole('button', { name: 'Dodaj danie: Obiad, środa, 7 października' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Szukaj przepisu').fill(title);
    await dialog.getByRole('radio', { name: new RegExp(title) }).click();
    await dialog.getByText('Ugotuj więcej na zapas').click();
    await expect(dialog.getByRole('textbox', { name: 'Ugotowane porcje' })).toHaveValue('2');
    await expect(dialog.getByText(/Na kolejne dni zostanie: 1 porcja/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Dodaj', exact: true }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByRole('button', { name: new RegExp(title) })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Zapasy do wykorzystania' })).toBeVisible();

    // Czwartek, obiad: porcja z zapasu
    await showDay(page, /czw/i);
    await page.getByRole('button', { name: 'Dodaj danie: Obiad, czwartek, 8 października' }).click();
    await expect(dialog.getByRole('radio', { name: 'Z zapasu (1)' })).toBeChecked();
    await dialog.getByRole('radio', { name: new RegExp(title) }).click();
    await dialog.getByRole('button', { name: 'Dodaj', exact: true }).click();
    await expect(dialog).toBeHidden();
    const leftover = page.getByRole('button', { name: new RegExp(`${title}.*z zapasu`) });
    await expect(leftover).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Zapasy do wykorzystania' })).toHaveCount(0);

    // Usunięcie posiłku z resztek
    await leftover.click();
    await dialog.getByRole('button', { name: 'Usuń z planu' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Zapasy do wykorzystania' })).toBeVisible();

    // Ustawienia: ukrycie II śniadania
    await page.getByRole('button', { name: 'Więcej' }).click();
    await page.getByRole('menuitem', { name: 'Ustawienia planera' }).click();
    await dialog.getByText('II śniadanie').click();
    await dialog.getByRole('button', { name: 'Gotowe' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: /Dodaj danie: II śniadanie/ })).toHaveCount(0);
    await expectNoA11yViolations(page);
  });

  test('tryb dokładny: dziecko bez konta, nakładanie, kto je i ważenie garnka', async ({ page, request }) => {
    const user = await createUser(request, 'rodzina');
    const title = `Gulasz ${Date.now().toString(36)}`;
    await createRecipe(request, user, title);
    await loginUi(page, user);

    // Gospodarstwo i dziecko bez konta
    await page.goto('/household');
    await page.getByLabel('Nazwa gospodarstwa').fill('Dom rodzinny');
    await page.getByRole('button', { name: 'Załóż' }).click();
    await page.getByRole('button', { name: 'Dodaj osobę' }).click();
    await page.getByLabel('Imię').fill('Ola');
    await page.getByLabel('Rok urodzenia').fill(String(new Date().getFullYear() - 8));
    await page.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await expect(page.getByText('Cel: 1530 kcal (wartość referencyjna dla wieku)')).toBeVisible();
    await expect(page.getByText('8 lat')).toBeVisible();
    await expectNoA11yViolations(page);

    // Włączenie trybu dokładnego
    await page.goto('/planner?week=2026-10-05&day=2026-10-07');
    const dialog = page.getByRole('dialog');
    // Menu bywa klikane przed końcem ładowania planu - ponawiamy do otwarcia okna
    await expect(async () => {
      await page.getByRole('button', { name: 'Więcej' }).click();
      await page.getByRole('menuitem', { name: 'Ustawienia planera' }).click({ timeout: 2000 });
      await expect(dialog).toBeVisible({ timeout: 2000 });
    }).toPass();
    await dialog.getByText('Dziel porcje według celów kcal każdej osoby').click();
    await dialog.getByRole('button', { name: 'Gotowe' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('group', { name: 'Czyj bilans pokazać' })).toBeVisible();

    // Danie na 2 porcje
    await page.getByRole('button', { name: 'Dodaj danie: Obiad, środa, 7 października' }).click();
    await dialog.getByLabel('Szukaj przepisu').fill(title);
    await dialog.getByRole('radio', { name: new RegExp(title) }).click();
    await dialog.getByRole('button', { name: 'Dodaj', exact: true }).click();
    await expect(dialog).toBeHidden();

    // Nakładanie: dwie osoby wg celów (ja bez profilu = 2000, Ola 1530)
    await page.getByRole('button', { name: new RegExp(title) }).click();
    const table = dialog.getByRole('table');
    await expect(table.getByRole('row', { name: /^Ty/ })).toContainText('57%');
    await expect(table.getByRole('row', { name: /^Ola/ })).toContainText('43%');

    // Zważony garnek 1000 g, Ola nie je
    await dialog.getByLabel('Waga całego garnka po ugotowaniu').fill('1000');
    await dialog.getByRole('checkbox', { name: 'Ola' }).uncheck();
    await dialog.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/bez: Ola/)).toBeVisible();

    await page.getByRole('button', { name: new RegExp(title) }).click();
    await expect(dialog.getByText('Na ten posiłek: 1000 g')).toBeVisible();
    await expect(table.getByRole('row', { name: /^Ty/ })).toContainText('1000 g');
    await expect(table.getByRole('row', { name: /^Ola/ })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Anuluj' }).click();

    // Bilans Oli: tego dnia nic nie je
    await page
      .getByRole('group', { name: 'Czyj bilans pokazać' })
      .getByRole('button', { name: 'Ola' })
      .click();
    await expect(page.getByText('Ola: nie je')).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
