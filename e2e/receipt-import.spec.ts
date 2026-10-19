import AxeBuilder from '@axe-core/playwright';
import { join } from 'node:path';
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

/** Prawdziwy składnik z bazy w kształcie, który zwraca serwer w szkicu */
async function ingredient(request: APIRequestContext, q: string) {
  const res = await request.get('/api/ingredients', { params: { q, pageSize: '1' } });
  const i = (await res.json()).items[0];
  return {
    id: i.id as string,
    namePl: i.namePl as string,
    nameEn: i.nameEn,
    density: i.density,
    units: i.units,
    category: { icon: i.category.icon },
  };
}

type Ing = Awaited<ReturnType<typeof ingredient>>;

const line = (key: number, text: string, ing: Ing | null, over: object = {}) => ({
  key,
  text,
  name: text.toLowerCase(),
  status: ing ? 'MATCHED' : 'NOT_FOUND',
  ingredient: ing,
  suggestions: [],
  packages: 1,
  packageAmount: 1,
  packageUnitCode: 'PIECE',
  priceCents: 100,
  lineTotalCents: 100,
  uncertain: false,
  warnings: [],
  ...over,
});

/** Serwer bez klucza API ukrywa funkcję - podmieniamy odpowiedzi (bez kosztów i sieci) */
async function mockReceipt(page: Page, draft: object) {
  const commits: Record<string, unknown>[] = [];
  await page.route('**/api/receipt-import/status', (route) =>
    route.fulfill({ json: { enabled: true, dailyLimit: 5, remaining: 5, maxPhotos: 4 } }),
  );
  await page.route('**/api/receipt-import', (route) => route.fulfill({ json: draft }));
  await page.route('**/api/receipt-import/*/commit', async (route) => {
    const body = route.request().postDataJSON();
    commits.push(body);
    const prices = body.lines.filter((l: { toPrices: boolean }) => l.toPrices).length;
    await route.fulfill({
      json: {
        pantry: body.lines.filter((l: { toPantry: boolean }) => l.toPantry).length,
        prices,
        list: body.toPrices
          ? { id: body.listId ?? 'nowy', name: body.newList?.name ?? 'Biedronka', created: !!body.newList }
          : null,
      },
    });
  });
  return commits;
}

async function token(request: APIRequestContext, user: TestUser) {
  const login = await request.post('/api/auth/login', {
    data: { login: user.username, password: TEST_PASSWORD },
  });
  return { Authorization: `Bearer ${(await login.json()).accessToken}` };
}

test.describe('Import paragonu', () => {
  test('z lodówki: cele, odczyt, poprawki, nowy cennik w trakcie importu i zatwierdzenie', async ({
    page,
    request,
  }) => {
    const user = await createUser(request, 'paragon');
    const milk = await ingredient(request, 'mleko 3,2');
    const eggs = await ingredient(request, 'jajko');
    const commits = await mockReceipt(page, {
      importId: '0190a000-0000-7000-8000-000000000001',
      store: 'Biedronka',
      purchasedOn: '2026-10-18',
      currency: 'PLN',
      currencyRead: 'PLN',
      suggestedListId: null,
      lines: [
        line(0, 'MLEKO UHT 3,2% 1L 2 x 4,29', milk, {
          packages: 2,
          packageUnitCode: 'l',
          priceCents: 429,
          lineTotalCents: 858,
        }),
        line(1, 'JAJA M 10SZT 12,99', eggs, { packageAmount: 10, priceCents: 1299, lineTotalCents: 1299 }),
        line(2, 'SMOCZE JAJO 99,99', null, {
          packageAmount: null,
          packageUnitCode: null,
          warnings: ['NO_PACKAGE_SIZE'],
        }),
      ],
      totalCents: 12156,
      skipped: 1,
      warnings: [],
    });

    await loginUi(page, user);
    await page.goto('/pantry');
    await page.getByRole('link', { name: 'Importuj paragon' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Import paragonu' })).toBeVisible();
    await expect(page.getByText('Dbamy o Twoją prywatność')).toBeVisible();

    // Oba cele domyślnie zaznaczone; bez celu nie da się odczytać
    const pantryBox = page.getByRole('checkbox', { name: 'Uzupełnij lodówkę' });
    const pricesBox = page.getByRole('checkbox', { name: 'Zaktualizuj cennik' });
    await expect(pantryBox).toBeChecked();
    await expect(pricesBox).toBeChecked();
    await expect(page.getByText('Nie masz jeszcze cennika')).toBeVisible();
    await page.locator('input[type=file]').setInputFiles(join(__dirname, 'fixtures', 'dish.jpg'));
    await expect(page.getByRole('img', { name: 'Zdjęcie paragonu 1' })).toBeVisible();
    await pantryBox.uncheck();
    await pricesBox.uncheck();
    await expect(page.getByText('Zaznacz co najmniej jedno')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Odczytaj paragon' })).toBeDisabled();
    await pantryBox.check();
    await pricesBox.check();
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Odczytaj paragon' }).click();

    // Podgląd: statusy, nieznana pozycja blokuje zatwierdzenie
    await expect(page.getByRole('heading', { name: 'Pozycje (3)' })).toBeVisible();
    await expect(page.getByLabel('Sklep')).toHaveValue('Biedronka');
    await expect(page.getByText('Nie znaleziono')).toBeVisible();
    await expect(page.getByText('Wybierz składnik z bazy.')).toBeVisible();
    const commit = page.getByRole('button', { name: 'Zatwierdź import' });
    await expect(commit).toBeDisabled();

    // Brak cennika: formularz z nazwą sklepu; anulowanie nie gubi pozycji
    const listForm = page.locator('app-price-list-form');
    await expect(listForm.getByRole('heading', { name: 'Załóż cennik na ceny z paragonu' })).toBeVisible();
    await expect(listForm.getByLabel('Nazwa')).toHaveValue('Biedronka');
    await listForm.getByRole('button', { name: 'Anuluj' }).click();
    await expect(page.getByRole('button', { name: 'Zapisz tylko do lodówki' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pozycje (3)' })).toBeVisible();
    await page.getByRole('button', { name: 'Jednak załóż cennik' }).click();
    await listForm.getByRole('button', { name: 'Zapamiętaj' }).click();
    await expect(
      page.getByText('Nowy cennik „Biedronka” (PLN) - utworzymy go przy zatwierdzeniu.'),
    ).toBeVisible();

    // Poprawki: usuwamy nieznaną pozycję, jajka tylko do lodówki, zmiana ceny mleka
    await page.getByRole('button', { name: 'Usuń pozycję: SMOCZE JAJO 99,99' }).click();
    const eggLine = page.getByRole('listitem').filter({ hasText: 'JAJA M 10SZT' });
    await eggLine.getByRole('checkbox', { name: 'do cennika' }).uncheck();
    const milkLine = page.getByRole('listitem').filter({ hasText: 'MLEKO UHT' });
    await milkLine.getByLabel('Cena za opakowanie (PLN)').fill('4,49');
    await expect(milkLine.getByText('Razem: 8,98 zł')).toBeVisible();

    const summary = page.getByRole('region', { name: 'Podsumowanie' });
    await expect(summary).toContainText('Do lodówki2');
    await expect(summary).toContainText('Do cennika1');
    await expect(summary).toContainText('nowy: Biedronka');
    await expectNoA11yViolations(page);
    await commit.click();

    await expect(page.getByRole('heading', { name: 'Zapisano zakupy z paragonu' })).toBeVisible();
    await expect(page.getByText('Utworzono cennik „Biedronka” i zapisano w nim 1 cen.')).toBeVisible();
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      toPantry: true,
      toPrices: true,
      newList: { name: 'Biedronka', currency: 'PLN' },
      store: 'Biedronka',
      purchasedOn: '2026-10-18',
      currency: 'PLN',
      lines: [
        {
          ingredientId: milk.id,
          toPantry: true,
          toPrices: true,
          packages: 2,
          packageAmount: 1,
          packageUnitCode: 'l',
          price: 4.49,
        },
        { ingredientId: eggs.id, toPantry: true, toPrices: false, packageAmount: 10, price: null },
      ],
    });
    expect(commits[0]).not.toHaveProperty('listId');
  });

  test('z cennika: istniejący cennik, obca waluta - ceny nie są zapisywane, informacja dla użytkownika', async ({
    page,
    request,
  }) => {
    const user = await createUser(request, 'waluta');
    await request.post('/api/prices', { headers: await token(request, user), data: { name: 'Lidl' } });
    const milk = await ingredient(request, 'mleko 3,2');
    const commits = await mockReceipt(page, {
      importId: '0190a000-0000-7000-8000-000000000002',
      store: 'Rewe',
      purchasedOn: null,
      currency: 'EUR',
      currencyRead: 'EUR',
      suggestedListId: null,
      lines: [
        line(0, 'MILCH 3,5% 1L 1,19', milk, { packageUnitCode: 'l', priceCents: 119, lineTotalCents: 119 }),
      ],
      totalCents: 119,
      skipped: 0,
      warnings: ['Paragon lekko rozmazany u dołu'],
    });

    await loginUi(page, user);
    await page.goto('/prices');
    await page.getByRole('link', { name: 'Importuj paragon' }).click();
    await expect(page).toHaveURL(/\/receipt-import\?from=prices/);
    await expect(page.locator('main').getByRole('link', { name: 'Cenniki' })).toHaveAttribute(
      'href',
      '/prices',
    );
    await page.locator('input[type=file]').setInputFiles(join(__dirname, 'fixtures', 'dish.jpg'));
    await page.getByRole('button', { name: 'Odczytaj paragon' }).click();

    await expect(page.getByText('Paragon lekko rozmazany u dołu')).toBeVisible();
    // Brak sklepu pasującego do nazwy - domyślny cennik "Lidl" (PLN) przy paragonie w EUR
    await expect(page.getByRole('combobox', { name: 'Cennik' })).toContainText('Lidl (PLN)');
    await expect(
      page.getByText(/Paragon jest w EUR, a cennik „Lidl” w PLN - ceny nie zostaną zapisane/),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'Podsumowanie' })).toContainText('Do cennika0');
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Zatwierdź import' }).click();
    await expect(page.getByRole('heading', { name: 'Zapisano zakupy z paragonu' })).toBeVisible();
    expect(commits[0]).toMatchObject({ toPantry: true, toPrices: false, currency: 'EUR' });
  });

  test('WCAG AA podglądu (pozycje, ostrzeżenia, nowy cennik) we wszystkich motywach', async ({
    page,
    request,
  }) => {
    test.slow();
    const user = await createUser(request, 'motywy');
    const milk = await ingredient(request, 'mleko 3,2');
    await mockReceipt(page, {
      importId: '0190a000-0000-7000-8000-000000000003',
      store: 'Biedronka',
      purchasedOn: '2026-10-18',
      currency: null,
      currencyRead: null,
      suggestedListId: null,
      lines: [
        line(0, 'MLEKO UHT 3,2% 1L 2 x 4,29', milk, {
          packages: 2,
          packageUnitCode: 'l',
          priceCents: 429,
          warnings: ['PRICE_MISMATCH'],
        }),
        {
          ...line(1, 'SMOCZE JAJO 99,99', null, { packageAmount: null, packageUnitCode: null }),
          status: 'CONFIRM',
          suggestions: [milk],
        },
      ],
      totalCents: 858,
      skipped: 0,
      warnings: ['Paragon ucięty u dołu'],
    });
    await loginUi(page, user);
    for (const theme of ['fresh', 'citrus', 'midnight', 'apricot', 'cinnamon', 'contrast']) {
      await page.evaluate((t) => localStorage.setItem('ck-theme', t), theme);
      await page.goto('/receipt-import');
      await page.locator('input[type=file]').setInputFiles(join(__dirname, 'fixtures', 'dish.jpg'));
      await page.getByRole('button', { name: 'Odczytaj paragon' }).click();
      await expect(page.getByRole('heading', { name: 'Pozycje (2)' })).toBeVisible();
      await page.waitForTimeout(500);
      await expectNoA11yViolations(page);
      await page.getByRole('button', { name: 'Zacznij od nowa' }).click();
    }
  });

  test('przycisk ukryty, gdy funkcja wyłączona (brak klucza API)', async ({ page, request }) => {
    const user = await createUser(request, 'bezai');
    await loginUi(page, user);
    await page.goto('/pantry');
    await expect(page.getByRole('heading', { level: 1, name: 'Lodówka' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Importuj paragon' })).toHaveCount(0);
  });
});
