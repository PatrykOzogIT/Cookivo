import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { createUser, loginUi } from './support/users';

async function expectNoA11yViolations(page: Page) {
  // Komunikaty pól pojawiają się z animacją - kontrast liczymy po jej końcu
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .exclude('.cdk-overlay-container')
    .analyze();
  expect(
    results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) })),
  ).toEqual([]);
}

const PHOTO = join(__dirname, 'fixtures', 'dish.jpg');

/** Odpowiedź serwera po odczycie (testy nigdy nie wołają prawdziwego API) */
const draft = (over: object = {}) => ({
  namePl: 'Jogurt naturalny bałkański 2%',
  nameEn: 'Balkan-style plain yogurt 2%',
  printedName: 'Jogurt Bałkański Kremowy 2%',
  category: 'DAIRY',
  values: {
    kcal: 61,
    protein: 4.3,
    fat: 2,
    saturatedFat: 1.3,
    carbs: 6.4,
    sugars: 6.4,
    fiber: null,
    salt: 0.13,
  },
  perMl: false,
  fromPortion: false,
  missing: [],
  portionUnknown: false,
  problem: null,
  noTable: false,
  liquid: false,
  ingredientsVisible: true,
  allergens: ['MILK'],
  mayContain: ['NUTS'],
  packageGrams: 400,
  warnings: [],
  similar: [],
  ...over,
});

async function mockLabel(page: Page, reply: (body: string) => object | { status: number; json: object }) {
  const bodies: string[] = [];
  await page.route('**/api/label-import/status', (r) =>
    r.fulfill({ json: { enabled: true, dailyLimit: 10, remaining: 9, maxPhotos: 2 } }),
  );
  await page.route('**/api/label-import', async (r) => {
    const body = r.request().postDataBuffer()?.toString('latin1') ?? '';
    bodies.push(body);
    const res = reply(body);
    if ('status' in res) await r.fulfill({ status: res.status as number, json: res.json });
    else await r.fulfill({ json: res });
  });
  return bodies;
}

test.describe('Składnik ze zdjęcia etykiety', () => {
  test('odczyt wypełnia formularz, podsumowanie mówi co sprawdzić, zapis ze źródłem "etykieta"', async ({
    page,
    request,
  }) => {
    const user = await createUser(request, 'etykieta');
    const name = `Jogurt bałkański ${Date.now().toString(36)}`;
    await mockLabel(page, () => draft({ namePl: name }));
    await loginUi(page, user);
    await page.goto('/ingredients/new');
    await expect(page.getByRole('heading', { name: 'Uzupełnij ze zdjęcia etykiety' })).toBeVisible();
    await expect(page.getByText('Zostało dziś: 9 z 10')).toBeVisible();
    await expectNoA11yViolations(page);

    await page.locator('app-label-import-panel input[type=file]').setInputFiles(PHOTO);
    const summary = page.getByRole('heading', { name: 'Odczytano z etykiety - sprawdź każde pole' });
    await expect(summary).toBeFocused();
    await expect(page.getByLabel('Nazwa po polsku')).toHaveValue(name);
    await expect(page.getByLabel('Wartość energetyczna')).toHaveValue('61');
    await expect(page.getByLabel('Białko')).toHaveValue('4,3');
    await expect(page.getByLabel('Błonnik')).toHaveValue('');
    await expect(page.getByRole('checkbox', { name: 'Mleko (w tym laktoza)' })).toBeChecked();
    await expect(page.getByText('Na opakowaniu: Jogurt Bałkański Kremowy 2%')).toBeVisible();
    await expect(page.getByText(/Może zawierać: Orzechy/)).toBeVisible();
    await expect(page.getByText('Zostało dziś: 8 z 10')).toBeVisible();
    await expectNoA11yViolations(page);

    const saved = page.waitForRequest((r) => r.url().endsWith('/api/ingredients') && r.method() === 'POST');
    await page.getByRole('button', { name: 'Zapisz składnik' }).click();
    expect((await saved).postDataJSON()).toMatchObject({
      namePl: name,
      kcal: 61,
      fiber: null,
      allergens: ['MILK'],
      units: [{ code: 'PACKAGE', grams: 400 }],
      fromLabel: true,
    });
    await expect(page.getByText(/Wartości z etykiety produktu, dodane przez użytkownika/)).toBeVisible();
  });

  test('nieczytelne: brak nazwy i wartości, tylko porcja; nazwa z formularza jako podpowiedź; nie etykieta', async ({
    page,
    request,
  }) => {
    const user = await createUser(request, 'nieczytelna');
    let call = 0;
    const bodies = await mockLabel(page, () => {
      call++;
      if (call === 1)
        return draft({
          namePl: null,
          values: {
            kcal: null,
            protein: 4.3,
            fat: null,
            saturatedFat: null,
            carbs: 6.4,
            sugars: null,
            fiber: null,
            salt: null,
          },
          missing: ['kcal', 'fat'],
          warnings: ['Tabela częściowo zasłonięta.'],
        });
      if (call === 2)
        return draft({
          namePl: 'Jogurt grecki',
          portionUnknown: true,
          values: {
            kcal: null,
            protein: null,
            fat: null,
            saturatedFat: null,
            carbs: null,
            sugars: null,
            fiber: null,
            salt: null,
          },
          missing: ['kcal', 'protein', 'fat', 'carbs'],
        });
      return { status: 422, json: { code: 'LABEL_NOT_LABEL', warnings: ['Na zdjęciu jest kot.'] } };
    });
    await loginUi(page, user);
    await page.goto('/ingredients/new');
    const input = page.locator('app-label-import-panel input[type=file]');

    await input.setInputFiles(PHOTO);
    await expect(page.getByText('Nie udało się odczytać nazwy - wpisz ją.')).toBeVisible();
    await expect(page.getByText(/Nieczytelne: Wartość energetyczna, Tłuszcze/)).toBeVisible();
    await expect(page.getByText('Tabela częściowo zasłonięta.')).toBeVisible();
    await expect(page.getByLabel('Wartość energetyczna')).toHaveValue('');
    await expectNoA11yViolations(page);

    // Nazwa wpisana w formularzu idzie jako podpowiedź do odczytu
    await page.getByLabel('Nazwa po polsku').fill('Jogurt grecki');
    await input.setInputFiles(PHOTO);
    await expect(page.getByText(/Wartości są tylko na porcję/)).toBeVisible();
    expect(bodies[1]).toContain('Jogurt grecki');

    await input.setInputFiles([PHOTO, PHOTO, PHOTO]);
    await expect(page.getByText('Wybierz najwyżej 2 zdjęcia: tabelę wartości i skład.')).toBeVisible();
    await input.setInputFiles(PHOTO);
    await expect(page.getByText(/To nie wygląda na etykietę produktu spożywczego/)).toBeVisible();
    await expect(page.getByText('Na zdjęciu jest kot.')).toBeVisible();
  });

  test('duble: podobne składniki przy wpisywaniu nazwy (także bez AI)', async ({ page, request }) => {
    const user = await createUser(request, 'duble');
    await loginUi(page, user);
    await page.goto('/ingredients/new');
    await page.getByLabel('Nazwa po polsku').fill('ziemniak');
    const notice = page.getByRole('status').filter({ hasText: 'Podobne składniki już są w bazie:' });
    await expect(notice).toBeVisible();
    await expect(notice.getByRole('link', { name: 'Ziemniaki' })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByLabel('Nazwa po polsku').fill('Coś całkiem nowego xyz');
    await expect(notice).toBeHidden();
  });
});
