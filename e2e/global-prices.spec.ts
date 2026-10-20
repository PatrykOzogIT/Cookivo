import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createUser, loginUi, sql, type TestUser } from './support/users';

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .exclude('.cdk-overlay-container')
    .analyze();
  expect(
    results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) })),
  ).toEqual([]);
}

async function ingredientId(request: APIRequestContext, q: string): Promise<string> {
  const res = await request.get('/api/ingredients', { params: { q, pageSize: '1' } });
  return (await res.json()).items[0].id;
}

/** Cena z paragonu innej osoby (bez płatnego API): odczyt w ai_imports + wpis historii cen */
async function receiptPrice(user: TestUser, ingredient: string, store: string, priceCents: number) {
  await sql(
    `WITH u AS (SELECT id FROM users WHERE email = $1),
          a AS (INSERT INTO ai_imports (id, user_id, kind, photos, success, created_at)
                SELECT gen_random_uuid(), u.id, 'RECEIPT', 1, true, now() FROM u RETURNING id, user_id),
          l AS (INSERT INTO price_lists (id, user_id, name, currency, is_default, created_at)
                SELECT gen_random_uuid(), a.user_id, $3, 'PLN', false, now() FROM a RETURNING id, user_id)
     INSERT INTO price_observations (id, user_id, list_id, ingredient_id, import_id, source, store_name,
       purchased_on, currency, package_amount, package_unit_code, package_grams, packages, price_cents, created_at)
     SELECT gen_random_uuid(), l.user_id, l.id, $2::uuid, a.id, 'RECEIPT', $3, current_date, 'PLN',
       1, 'l', 1030, 1, $4, now() FROM l, a`,
    [user.email, ingredient, store, priceCents],
  );
}

test.describe('Ceny ogólne z paragonów', () => {
  test('podpowiedź w cenniku ("Użyj") i aktualizacja starej ceny ("Zaktualizuj")', async ({
    page,
    request,
  }) => {
    const milk = await ingredientId(request, 'mleko 3,2');
    const seller = await createUser(request, 'paragony');
    await receiptPrice(seller, milk, 'Biedronka', 339);
    await receiptPrice(seller, milk, 'Biedronka', 339);

    const user = await createUser(request, 'cennik');
    await loginUi(page, user);
    await page.goto('/prices');
    await page.getByLabel('Nazwa').fill('Biedronka');
    await page.getByRole('button', { name: 'Utwórz cennik' }).click();
    await page.getByRole('combobox', { name: 'Dodaj cenę składnika' }).fill('mleko 3,2');
    await page
      .getByRole('option', { name: /Mleko 3,2%/ })
      .first()
      .click();
    await expect(page.getByText('Cena ogólna w sieci „Biedronka”: ok. 3,39 zł / l.')).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Użyj' }).click();
    await expect(page.getByLabel('Opakowanie (ilość)')).toHaveValue('1');
    await expect(page.getByLabel('Cena (PLN)')).toHaveValue('3,39');

    // Zapisujemy inną (własną) cenę i "postarzamy" ją o 100 dni
    await page.getByLabel('Cena (PLN)').fill('2,99');
    await page
      .locator('form.draft')
      .getByRole('button', { name: /Zapisz/ })
      .click();
    const row = page.getByRole('listitem').filter({ hasText: 'Mleko 3,2%' });
    await expect(row).toContainText('2,99 zł');
    await sql(
      `UPDATE price_entries e SET updated_at = now() - interval '100 days'
       FROM price_lists l, users u WHERE e.list_id = l.id AND l.user_id = u.id AND u.email = $1`,
      [user.email],
    );
    await page.reload();
    await expect(row).toContainText('cena ogólna teraz: ok. 3,39 zł / l');
    await expectNoA11yViolations(page);
    await row.getByRole('button', { name: /Zaktualizuj cenę: Mleko 3,2% na 3,39/ }).click();
    await expect(row).toContainText('3,39 zł');
    await expect(row.getByRole('button', { name: /Zaktualizuj/ })).toHaveCount(0);
  });

  test('bez cennika koszt listy zakupów z cen ogólnych, z oznaczeniem', async ({ page, request }) => {
    const milk = await ingredientId(request, 'mleko 3,2');
    const seller = await createUser(request, 'paragony2');
    await receiptPrice(seller, milk, 'Lidl', 339);

    const user = await createUser(request, 'bezcennika');
    await loginUi(page, user);
    await page.goto('/shopping');
    await page.getByRole('combobox', { name: 'Dodaj składnik albo własną pozycję' }).fill('mleko 3,2');
    await page
      .getByRole('option', { name: /Mleko 3,2%/ })
      .first()
      .click();
    await page.getByLabel('Ilość (opcjonalnie)').fill('2');
    await page.getByRole('combobox', { name: 'Jednostka' }).click();
    await page.getByRole('option', { name: 'l', exact: true }).click();
    await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
    await expect(page.getByText(/Szacowany koszt: ok\. .* \(wg cen ogólnych z paragonów\)/)).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Mleko 3,2%' })).toContainText('(cena ogólna)');
    await expectNoA11yViolations(page);
  });
});
