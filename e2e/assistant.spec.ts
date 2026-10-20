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

const card = (id: string, title: string) => ({ id, title, kcalPerServing: 400, minutes: 20, cover: null });

/** Serwer bez klucza API ukrywa asystenta - podmieniamy odpowiedzi (bez kosztów i sieci) */
async function mockAssistant(page: Page, replies: Record<string, unknown>) {
  const calls: { url: string; body: unknown }[] = [];
  await page.route('**/api/assistant/status', (r) =>
    r.fulfill({ json: { enabled: true, dailyLimit: 5, remaining: 4 } }),
  );
  for (const path of ['ask', 'variant', 'plan/apply', 'shopping/apply']) {
    await page.route(`**/api/assistant/${path}`, async (r) => {
      const body = r.request().postDataJSON();
      calls.push({ url: path, body });
      const reply = replies[path];
      await r.fulfill({ json: typeof reply === 'function' ? reply(body) : reply });
    });
  }
  return calls;
}

async function token(request: APIRequestContext, user: TestUser) {
  const login = await request.post('/api/auth/login', {
    data: { login: user.username, password: TEST_PASSWORD },
  });
  return { Authorization: `Bearer ${(await login.json()).accessToken}` };
}

test.describe('Asystent', () => {
  test('panel: plan tygodnia (zamiana, usunięcie, zapis), odmowa spoza tematu, Escape i fokus', async ({
    page,
    request,
  }) => {
    const user = await createUser(request, 'asystent');
    const calls = await mockAssistant(page, {
      ask: (body: { action?: string; text?: string }) =>
        body.action === 'PLAN'
          ? {
              type: 'PLAN',
              summary: 'Lekkie śniadania i sycące obiady.',
              people: 1,
              days: [
                {
                  date: '2026-10-22',
                  meals: [
                    {
                      slot: 'BREAKFAST',
                      leftover: false,
                      recipe: card('a', 'Owsianka'),
                      alternatives: [card('b', 'Jogurt z musli')],
                    },
                    { slot: 'DINNER', leftover: false, recipe: card('c', 'Gulasz'), alternatives: [] },
                  ],
                },
                {
                  date: '2026-10-23',
                  meals: [{ slot: 'DINNER', leftover: true, recipe: card('c', 'Gulasz'), alternatives: [] }],
                },
              ],
            }
          : { type: 'MESSAGE', code: 'OFF_TOPIC' },
      'plan/apply': { added: 2 },
    });

    await loginUi(page, user);
    const fab = page.getByRole('button', { name: 'Asystent', exact: true });
    await fab.click();
    const panel = page.getByRole('dialog', { name: 'Asystent Cookivo' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Zostało dziś: 4 z 5 zadań.')).toBeVisible();
    await expectNoA11yViolations(page);

    // Spoza tematu - uprzejma odmowa
    await panel.getByLabel('Napisz, czego potrzebujesz').fill('Opowiedz mi kawał');
    await panel.getByRole('button', { name: 'Wyślij' }).click();
    await expect(panel.getByText(/Pomagam tylko w planowaniu posiłków/)).toBeVisible();

    // Plan: zamiana śniadania i usunięcie obiadu z drugiego dnia
    await panel.getByRole('button', { name: 'Plan na tydzień' }).click();
    await expect(panel.getByText('Lekkie śniadania i sycące obiady.')).toBeVisible();
    await expect(panel.getByText('z wcześniejszego gotowania')).toBeVisible();
    await panel.getByRole('button', { name: 'Zamień: Owsianka' }).click();
    await expect(panel.getByRole('link', { name: 'Jogurt z musli' })).toBeVisible();
    await panel.getByRole('button', { name: 'Usuń z planu: Gulasz' }).last().click();
    await expectNoA11yViolations(page);
    await panel.getByRole('button', { name: 'Zapisz w planerze (2)' }).click();
    await expect(panel.getByText('Zapisano w planerze: 2 posiłków.')).toBeVisible();
    expect(calls.find((c) => c.url === 'plan/apply')?.body).toEqual({
      meals: [
        { date: '2026-10-22', slot: 'BREAKFAST', recipeId: 'b', leftover: false },
        { date: '2026-10-22', slot: 'DINNER', recipeId: 'c', leftover: false },
      ],
    });

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(fab).toBeFocused();
  });

  test('WCAG AA otwartego panelu z planem we wszystkich motywach', async ({ page, request }) => {
    test.slow();
    const user = await createUser(request, 'motywyai');
    await mockAssistant(page, {
      ask: {
        type: 'PLAN',
        summary: 'Plan.',
        people: 1,
        days: [
          {
            date: '2026-10-22',
            meals: [
              {
                slot: 'DINNER',
                leftover: true,
                recipe: card('c', 'Gulasz'),
                alternatives: [card('d', 'Leczo')],
              },
            ],
          },
        ],
      },
    });
    await loginUi(page, user);
    for (const theme of ['fresh', 'citrus', 'midnight', 'apricot', 'cinnamon', 'contrast']) {
      await page.evaluate((t) => localStorage.setItem('ck-theme', t), theme);
      await page.reload();
      await page.getByRole('button', { name: 'Asystent', exact: true }).click();
      const panel = page.getByRole('dialog', { name: 'Asystent Cookivo' });
      await panel.getByRole('button', { name: 'Plan na tydzień' }).click();
      await expect(panel.getByRole('link', { name: 'Gulasz' })).toBeVisible();
      await page.mouse.move(0, 0);
      await expectNoA11yViolations(page);
      await page.keyboard.press('Escape');
    }
  });

  test('uzupełnij zakupy: zaznaczanie pozycji i dodanie do listy', async ({ page, request }) => {
    const user = await createUser(request, 'zakupyai');
    const milk = { id: 'm', namePl: 'Mleko 3,2%', nameEn: 'Milk', icon: 'water_drop' };
    const carrot = { id: 'k', namePl: 'Marchew', nameEn: 'Carrot', icon: 'eco' };
    const calls = await mockAssistant(page, {
      ask: {
        type: 'SHOPPING',
        plan: [
          { ingredient: carrot, grams: 400, amount: { amount: 400, unit: 'g', grams: 400 }, reason: 'PLAN' },
        ],
        regular: [
          {
            ingredient: milk,
            grams: 2060,
            amount: { amount: 2, unit: 'l', grams: 2060 },
            reason: 'REGULAR',
            everyDays: 5,
            lastDaysAgo: 6,
          },
        ],
      },
      'shopping/apply': { added: 1 },
    });
    await loginUi(page, user);
    await page.getByRole('button', { name: 'Asystent', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Asystent Cookivo' });
    await panel.getByRole('button', { name: 'Uzupełnij zakupy' }).click();
    await expect(panel.getByText('co ~5 dni, ostatnio 6 dni temu')).toBeVisible();
    await panel.getByRole('checkbox', { name: /Marchew/ }).uncheck();
    await expectNoA11yViolations(page);
    await panel.getByRole('button', { name: 'Dodaj zaznaczone (1)' }).click();
    await expect(panel.getByText('Dodano do listy: 1 poz.')).toBeVisible();
    expect(calls.find((c) => c.url === 'shopping/apply')?.body).toEqual({
      items: [{ ingredientId: 'm', grams: 2060 }],
    });
  });

  test('„Zrób z tego wersję…”: szkic w formularzu z listą zmian, zapis jako wersja', async ({
    page,
    request,
  }) => {
    const user = await createUser(request, 'wersja');
    const headers = await token(request, user);
    const egg = (
      await (await request.get('/api/ingredients', { params: { q: 'jajko', pageSize: '1' } })).json()
    ).items[0];
    const created = await request.post('/api/recipes', {
      headers,
      data: {
        title: 'Placki babci',
        servings: 2,
        visibility: 'PRIVATE',
        canBeIngredient: false,
        mealTypes: [],
        ingredients: [{ ingredientId: egg.id, amount: 2, unitCode: 'PIECE' }],
        steps: [{ text: 'Usmaż.' }],
        photoIds: [],
      },
    });
    const original = (await created.json()).id as string;
    const match = {
      id: egg.id,
      namePl: egg.namePl,
      nameEn: egg.nameEn,
      density: egg.density,
      units: egg.units,
    };
    const calls = await mockAssistant(page, {
      variant: {
        type: 'VARIANT',
        recipeId: original,
        draft: {
          title: 'Placki babci bez glutenu',
          description: null,
          servings: 2,
          prepMinutes: 10,
          cookMinutes: 15,
          ingredients: [
            {
              text: '2 jajka',
              name: 'jajko',
              amount: 2,
              unitCode: 'PIECE',
              note: null,
              match,
              suggestions: [],
              uncertain: false,
              unitProblem: false,
            },
          ],
          steps: ['Wymieszaj z mąką ryżową.', 'Usmaż.'],
          warnings: [],
        },
        changes: [{ change: 'Mąka ryżowa zamiast pszennej', why: 'Bez glutenu, podobna konsystencja.' }],
      },
    });

    await loginUi(page, user);
    await page.goto(`/recipes/${original}`);
    await page.getByRole('button', { name: 'Zrób z tego wersję…' }).click();
    const panel = page.getByRole('dialog', { name: 'Asystent Cookivo' });
    await expect(panel.getByText('Wersja przepisu: Placki babci')).toBeVisible();
    await panel.getByRole('radio', { name: 'Bez glutenu' }).click();
    await expectNoA11yViolations(page);
    await panel.getByRole('button', { name: 'Przygotuj wersję' }).click();

    await expect(page).toHaveURL(/\/recipes\/new\?variantOf=/);
    await expect(page.getByLabel('Nazwa przepisu')).toHaveValue('Placki babci bez glutenu');
    await expect(page.getByText('Mąka ryżowa zamiast pszennej')).toBeVisible();
    await expect(page.getByText(/Na podstawie|Wersja przepisu/).first()).toBeVisible();
    expect(calls.find((c) => c.url === 'variant')?.body).toMatchObject({
      recipeId: original,
      kind: 'GLUTEN_FREE',
    });

    const save = page.waitForResponse(
      (r) => r.url().endsWith('/api/recipes') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Zapisz przepis' }).click();
    const saved = await (await save).json();
    expect(saved.variantOf).toMatchObject({ id: original });
  });
});
