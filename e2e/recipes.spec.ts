import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { createUser, loginUi } from './support/users';

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) })),
  ).toEqual([]);
}

/**
 * Wybiera pozycję w polu "Składnik" z podpowiedzi - klawiaturą (Enter na pierwszej,
 * najlepiej dopasowanej opcji). Sprawdza obsługę bez myszy i omija niestabilne klikanie
 * w panel nakładki w WebKit, który nie przewija pola do widoku przy `fill`.
 */
async function pickIngredient(page: Page, row: number, query: string, option: string) {
  const input = page.getByRole('combobox', { name: 'Składnik', exact: true }).nth(row);
  await input.scrollIntoViewIfNeeded();
  await input.fill(query);
  // WebKit dokleja do nazwy opcji etykietę grupy ("Jajko (Składniki)") - dopasowujemy początek
  const escaped = option.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);
  await expect(page.getByRole('option', { name: new RegExp(`^${escaped}(\\W|$)`) }).first()).toBeAttached();
  await input.press('Enter');
  await expect(input).toHaveValue(option);
}

test.describe('Przepisy', () => {
  test('dodanie przepisu z formularza, podgląd, porcje i tryb gotowania', async ({ page, request }) => {
    const author = await createUser(request, 'kucharz');
    const title = `Jajecznica testowa ${Date.now().toString(36)}`;

    await loginUi(page, author);
    await page.goto('/recipes/new');
    await expect(page.getByRole('heading', { level: 1, name: 'Nowy przepis' })).toBeVisible();
    await expectNoA11yViolations(page);

    await page.getByLabel('Nazwa przepisu').fill(title);
    await page.getByLabel('Porcje').fill('2');
    await page.getByLabel('Gotowanie (min)', { exact: true }).fill('10');
    await page.getByRole('checkbox', { name: 'Śniadanie' }).check();

    // Zdjęcie (zmniejszane w przeglądarce i wysyłane od razu)
    await page
      .locator('app-photo-picker input[type=file]:not([capture])')
      .first()
      .setInputFiles(join(__dirname, 'fixtures', 'dish.jpg'));
    await expect(page.getByText('Okładka')).toBeVisible();

    // Składniki: jajka w sztukach (domyślna jednostka) i mleko w szklankach
    await pickIngredient(page, 0, 'jajko', 'Jajko');
    await page.getByLabel('Ilość').nth(0).fill('3');
    await expect(page.getByText('≈ 150 g')).toBeVisible();
    await page.getByRole('button', { name: 'Dodaj składnik' }).click();
    await pickIngredient(page, 1, 'mleko 3', 'Mleko 3,2%');
    await page.getByLabel('Ilość').nth(1).fill('0,5');
    // Dla płynów domyślne są ml - wybieramy szklankę (z klawiatury)
    await page.getByRole('combobox', { name: 'Jednostka' }).nth(1).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: 'szklanka' }).click();
    await expect(page.getByText('≈ 129 g')).toBeVisible();

    await page
      .getByLabel('Krok 1', { exact: true })
      .fill('Roztrzep jajka z mlekiem i smaż na maśle, mieszając.');
    await page.getByLabel('Minutnik (min)').fill('5');
    await page.getByRole('radio', { name: 'Wszyscy (publiczny)' }).check();
    await page.getByRole('button', { name: 'Zapisz przepis' }).click();

    // --- Strona przepisu ---
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page).toHaveTitle(`${title} · Cookivo`);
    const ingredients = page
      .getByRole('region', { name: 'Składniki' })
      .or(page.locator('section.ingredients'));
    await expect(ingredients.getByText('3 sztuki')).toBeVisible();
    await expect(ingredients.getByText('½ szklanki')).toBeVisible();
    await expect(page.locator('.allergens li')).toHaveText([/Jaja/, /Mleko/]);
    await expect(page.locator('img.main')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Wartości odżywcze' })).toBeVisible();
    await expectNoA11yViolations(page);

    // Skalowanie: 2 → 4 porcje
    await page.getByRole('button', { name: 'Więcej porcji' }).click();
    await page.getByRole('button', { name: 'Więcej porcji' }).click();
    await expect(ingredients.getByText('6 sztuk')).toBeVisible();
    await expect(ingredients.getByText('1 szklanka')).toBeVisible();

    // --- Tryb gotowania ---
    await page.getByRole('link', { name: 'Gotuj' }).click();
    await expect(page).toHaveURL(/\/cook\?servings=4/);
    await expect(page.getByText('porcje: 4')).toBeVisible();
    await page.getByRole('checkbox', { name: /6 sztuk/ }).check();
    await page.getByRole('button', { name: 'Zaczynamy' }).click();
    await expect(page.getByText('Krok 1 z 1')).toBeVisible();
    await page.getByRole('button', { name: 'Start 5 min' }).click();
    await expect(page.getByRole('timer')).toHaveText(/0[45]:[0-5]\d/);
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Gotowe!' }).click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  });

  test('gość widzi przepisy publiczne i filtruje je', async ({ page, request, browser }) => {
    const author = await createUser(request, 'filtry');
    const title = `Omlet filtrowany ${Date.now().toString(36)}`;
    await loginUi(page, author);

    // Przepis zakładamy przez API zalogowanego użytkownika (formularz testuje poprzedni scenariusz)
    const token = await page.evaluate(async () => {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      return ((await res.json()) as { accessToken: string }).accessToken;
    });
    const egg = (await (await request.get('/api/ingredients?q=jajko&pageSize=10')).json()).items.find(
      (i: { namePl: string }) => i.namePl === 'Jajko',
    );
    const created = await request.post('/api/recipes', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        title,
        servings: 1,
        visibility: 'PUBLIC',
        canBeIngredient: false,
        mealTypes: ['BREAKFAST'],
        ingredients: [{ ingredientId: egg.id, amount: 2, unitCode: 'PIECE' }],
        steps: [{ text: 'Usmaż.' }],
        photoIds: [],
      },
    });
    expect(created.status()).toBe(201);

    const guestContext = await browser.newContext();
    const guest = await guestContext.newPage();
    await guest.goto(`/recipes?q=${encodeURIComponent(title)}&meal=BREAKFAST`);
    await expect(guest.getByRole('link', { name: new RegExp(title) })).toBeVisible();
    await expectNoA11yViolations(guest);

    await guest.goto(`/recipes?q=${encodeURIComponent(title)}&allergens=EGGS`);
    await expect(guest.getByText('Żaden przepis nie pasuje do wybranych filtrów.')).toBeVisible();

    await guest.goto('/recipes/new');
    await expect(guest).toHaveURL(/\/auth\/login/);
    await guestContext.close();
  });
});
