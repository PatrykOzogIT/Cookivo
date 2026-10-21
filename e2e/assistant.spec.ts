import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createUser, loginUi, TEST_PASSWORD, type TestUser } from './support/users';

async function expectNoA11yViolations(page: Page) {
  // Panel wysuwa się z animacją przezroczystości - kontrast liczymy po jej końcu
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .exclude('.cdk-overlay-container')
    .analyze();
  expect(
    results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) })),
  ).toEqual([]);
}

const card = (id: string, title: string, costPerServingCents: number | null = 1250) => ({
  id,
  title,
  kcalPerServing: 400,
  minutes: 20,
  cover: null,
  costPerServingCents,
});

/** Serwer bez klucza API ukrywa asystenta - podmieniamy odpowiedzi (bez kosztów i sieci) */
async function mockAssistant(page: Page, replies: Record<string, unknown>) {
  const calls: { url: string; body: unknown }[] = [];
  await page.route('**/api/assistant/status', (r) =>
    r.fulfill({ json: { enabled: true, dailyLimit: 5, remaining: 4 } }),
  );
  for (const path of [
    'ask',
    'variant',
    'plan/apply',
    'shopping/apply',
    'shopping/parse',
    'substitute',
    'prep',
  ]) {
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
              currency: 'PLN',
              budgetCents: 3000,
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
                  meals: [
                    { slot: 'DINNER', leftover: true, recipe: card('c', 'Gulasz', null), alternatives: [] },
                  ],
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

    // Szybka akcja tylko się zaznacza - można dopisać życzenia i dopiero wysłać
    const chip = panel.getByRole('button', { name: 'Plan na tydzień' });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    const input = panel.getByLabel(/Dopisz życzenia/);
    await expect(input).toBeFocused();
    expect(calls.filter((c) => c.url === 'ask')).toHaveLength(1);
    await input.fill('obiady sycące, do 30 zł');
    await panel.getByRole('button', { name: 'Wyślij' }).click();
    await expect(panel.getByText('Lekkie śniadania i sycące obiady.')).toBeVisible();
    expect(calls.filter((c) => c.url === 'ask')[1].body).toEqual({
      action: 'PLAN',
      text: 'obiady sycące, do 30 zł',
      lang: 'pl',
    });
    await expect(panel.getByText('Plan na tydzień: obiady sycące, do 30 zł')).toBeVisible();
    // Koszt: 2 posiłki × 12,50 zł (resztki bez ceny), budżet 30 zł
    await expect(panel.getByText(/Koszt planu: ok\. 25,00\s?zł \(budżet 30,00\s?zł\)/)).toBeVisible();
    await expect(panel.getByText('Posiłki bez ceny (nie wliczone): 1')).toBeVisible();
    await expect(panel.getByText(/12,50\s?zł\/porcja/).first()).toBeVisible();
    await expect(panel.getByText('Ponad budżet')).toBeHidden();
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
        currency: 'PLN',
        budgetCents: null,
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
      await panel.getByRole('button', { name: 'Wyślij' }).click();
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
    await panel.getByRole('button', { name: 'Wyślij' }).click();
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

  test('dyktowanie listy zakupów: tekst → podgląd → dodanie (składnik z bazy i własna pozycja)', async ({
    page,
    request,
  }) => {
    const user = await createUser(request, 'dyktuje');
    const carrot = (
      await (await request.get('/api/ingredients', { params: { q: 'marchew', pageSize: '1' } })).json()
    ).items[0];
    const calls = await mockAssistant(page, {
      'shopping/parse': {
        items: [
          {
            name: 'marchew',
            amount: 1,
            unit: 'kg',
            note: null,
            ingredient: { ...carrot, icon: carrot.icon ?? null },
          },
          { name: 'papier do pieczenia', amount: null, unit: null, note: null, ingredient: null },
          { name: 'zapałki', amount: null, unit: null, note: null, ingredient: null },
        ],
      },
    });
    await loginUi(page, user);
    await page.goto('/shopping');
    await page.getByRole('button', { name: 'Podyktuj albo wklej listę' }).click();
    await page.getByLabel('Co kupić?').fill('kilo marchwi, papier do pieczenia i zapałki');
    await page.getByRole('button', { name: 'Rozpoznaj pozycje' }).click();
    await expect(
      page.getByRole('checkbox', { name: /Papier do pieczenia|papier do pieczenia/ }),
    ).toBeChecked();
    await page.getByRole('checkbox', { name: /zapałki/ }).uncheck();
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Dodaj do listy (2)' }).click();
    await expect(page.getByRole('button', { name: 'Podyktuj albo wklej listę' })).toBeVisible();
    expect(calls.find((c) => c.url === 'shopping/parse')?.body).toEqual({
      text: 'kilo marchwi, papier do pieczenia i zapałki',
    });
    const list = (await (await request.get('/api/shopping', { headers: await token(request, user) })).json())
      .items as { name: string | null; ingredient: { id: string } | null }[];
    expect(list).toHaveLength(2);
    expect(list.find((i) => i.ingredient?.id === carrot.id)).toMatchObject({
      amount: { unit: 'kg', manual: true },
    });
    expect(list.find((i) => !i.ingredient)?.name).toBe('papier do pieczenia');
  });

  test('tryb gotowania: „Nie mam” pokazuje zamienniki asystenta', async ({ page, request }) => {
    const user = await createUser(request, 'zamiennik');
    const headers = await token(request, user);
    const egg = (
      await (await request.get('/api/ingredients', { params: { q: 'jajko', pageSize: '1' } })).json()
    ).items[0];
    const created = await request.post('/api/recipes', {
      headers,
      data: {
        title: 'Placki na szybko',
        servings: 2,
        visibility: 'PRIVATE',
        canBeIngredient: false,
        mealTypes: [],
        ingredients: [{ ingredientId: egg.id, amount: 2, unitCode: 'PIECE' }],
        steps: [{ text: 'Usmaż.' }],
        photoIds: [],
      },
    });
    const id = (await created.json()).id as string;
    const calls = await mockAssistant(page, {
      substitute: {
        options: [
          {
            name: 'Siemię lniane z wodą',
            amount: '2 łyżki + 6 łyżek wody',
            note: 'Placki będą mniej puszyste.',
            inPantry: false,
          },
          { name: 'Mleko', amount: '3 łyżki', note: 'Doda wilgoci.', inPantry: true },
        ],
        tip: 'Smaż na mniejszym ogniu.',
      },
    });
    await loginUi(page, user);
    await page.goto(`/recipes/${id}/cook`);
    const missing = page.getByRole('button', { name: 'Nie mam' });
    await missing.click();
    await expect(missing).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Siemię lniane z wodą')).toBeVisible();
    await expect(page.getByText('masz w lodówce')).toBeVisible();
    await expect(page.getByText('Smaż na mniejszym ogniu.')).toBeVisible();
    const body = calls.find((c) => c.url === 'substitute')?.body as {
      recipeId: string;
      lineId: string;
      lang: string;
    };
    expect(body).toMatchObject({ recipeId: id, lang: 'pl' });
    expect(body.lineId).toBeTruthy();
    await expectNoA11yViolations(page);
    await missing.click();
    await expect(page.getByText('Siemię lniane z wodą')).toBeHidden();
  });

  test('plan gotowania: partie z planu → harmonogram z godzinami, tłem, odhaczaniem i minutnikiem', async ({
    page,
    request,
  }) => {
    test.slow();
    const user = await createUser(request, 'mealprep');
    const headers = await token(request, user);
    const carrot = (
      await (await request.get('/api/ingredients', { params: { q: 'marchew', pageSize: '1' } })).json()
    ).items[0];
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    const date = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    for (const title of ['Pieczone warzywa', 'Zupa marchewkowa']) {
      const r = await request.post('/api/recipes', {
        headers,
        data: {
          title,
          servings: 4,
          visibility: 'PRIVATE',
          canBeIngredient: false,
          mealTypes: ['DINNER'],
          ingredients: [{ ingredientId: carrot.id, amount: 500, unitCode: 'g' }],
          steps: [{ text: 'Krok pierwszy.' }, { text: 'Krok drugi.', timerMinutes: 40 }],
          photoIds: [],
        },
      });
      await request.post('/api/planner/meals', {
        headers,
        data: { date, slot: 'DINNER', recipeId: (await r.json()).id, servings: 6 },
      });
    }
    const step = (dish: string, index: number, start: number, minutes: number, wait = 0, extra = {}) => ({
      dish,
      index,
      text: `${dish === 'A' ? 'Warzywa' : 'Zupa'}: krok ${index}`,
      timerMinutes: null,
      start,
      minutes,
      wait,
      background: wait ? (dish === 'A' ? 'piecze się' : 'gotuje się') : null,
      equipment: wait ? (dish === 'A' ? 'OVEN' : 'HOB') : 'NONE',
      estimated: true,
      ...extra,
    });
    const calls = await mockAssistant(page, {
      prep: (body: { cookIds: string[] }) => ({
        type: 'PREP',
        summary: 'Zacznij od warzyw do pieczenia.',
        tips: ['Nagrzej piekarnik na początku.'],
        dishes: body.cookIds.map((cookId, i) => ({
          letter: 'AB'[i],
          cookId,
          recipeId: '0190a000-0000-7000-8000-00000000000' + i,
          title: ['Pieczone warzywa', 'Zupa marchewkowa'][i],
          servings: 6,
          date,
        })),
        skipped: [],
        steps: [
          step('A', 1, 0, 15),
          step('A', 2, 15, 2, 38, { timerMinutes: 40, estimated: false }),
          step('B', 1, 17, 10),
          step('B', 2, 27, 3, 22),
        ],
        end: 55,
        handsOn: 30,
        oven: [{ from: 15, to: 55 }],
      }),
    });
    await page.clock.install();
    await loginUi(page, user);
    await page.goto('/planner');
    await page.getByRole('link', { name: 'Plan gotowania' }).click();
    await expect(page.getByRole('heading', { name: 'Plan gotowania', level: 1 })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Pieczone warzywa/ })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /Zupa marchewkowa/ })).toBeChecked();
    await expectNoA11yViolations(page);
    await page.getByLabel('Start o').fill('09:30');
    await page.getByRole('button', { name: 'Ułóż harmonogram' }).click();

    await expect(page.getByRole('heading', { name: 'Zacznij od warzyw do pieczenia.' })).toBeVisible();
    expect((calls.find((c) => c.url === 'prep')?.body as { cookIds: string[] }).cookIds).toHaveLength(2);
    const metrics = page.locator('.metrics');
    await expect(metrics.getByText('10:25', { exact: true })).toBeVisible();
    await expect(metrics.getByText('55 min')).toBeVisible();
    await expect(metrics.getByText('09:45–10:25')).toBeVisible();
    const rows = page.locator('.step-list > li');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toHaveAttribute('aria-current', 'step');
    await expect(rows.nth(2).getByText('piecze się do 10:25')).toBeVisible();
    await expect(rows.nth(3).getByText('gotuje się do 10:22')).toBeVisible();
    await expect(page.getByText('ok. 15 min (szacunek)')).toBeVisible();
    await expectNoA11yViolations(page);

    // Odhaczenie przesuwa "teraz"; zmiana startu przelicza godziny bez AI
    await rows.nth(0).getByRole('checkbox').check();
    await expect(rows.nth(1)).toHaveAttribute('aria-current', 'step');
    await page.getByLabel('Start o').fill('11:00');
    await expect(rows.nth(1).getByText('11:15')).toBeVisible();
    expect(calls.filter((c) => c.url === 'prep')).toHaveLength(1);

    // Minutnik kroku z przepisu
    await rows.nth(1).getByRole('button', { name: 'Minutnik 40 min' }).click();
    await expect(rows.nth(1).getByRole('timer')).toHaveText(/^(40:00|39:5\d)$/);
    await page.clock.runFor(61_000);
    await expect(rows.nth(1).getByRole('timer')).toHaveText(/^38:\d\d$/);

    // Stan przeżywa wyjście z ekranu
    await page.getByRole('link', { name: 'Wróć do planera' }).click();
    await page.getByRole('link', { name: 'Plan gotowania' }).click();
    await expect(rows.nth(0).getByRole('checkbox')).toBeChecked();
    await page.getByRole('button', { name: 'Ułóż od nowa' }).click();
    await expect(page.getByRole('button', { name: 'Ułóż harmonogram' })).toBeVisible();
  });

  test('WCAG AA planu gotowania we wszystkich motywach', async ({ page, request }) => {
    test.slow();
    const user = await createUser(request, 'prepmotywy');
    await mockAssistant(page, {});
    await page.route('**/api/planner?*', (r) =>
      r.fulfill({
        json: {
          scope: 'USER',
          people: 1,
          freshDays: 3,
          settings: { hiddenSlots: [], exactPortions: false },
          slots: [],
          targets: null,
          persons: [],
          cost: null,
          leftovers: [],
          meals: ['A', 'B', 'C', 'D'].map((l, i) => ({
            id: 'm' + i,
            date: '2099-01-0' + (i + 1),
            slot: 'DINNER',
            servings: 4,
            myServings: 4,
            absent: [],
            shares: null,
            grams: null,
            cook: {
              id: 'c' + i,
              date: '2099-01-0' + (i + 1),
              servings: 4,
              remaining: 0,
              mealsCount: 1,
              potGrams: null,
              gramsSource: null,
            },
            fromLeftovers: false,
            daysAfterCooking: 0,
            stale: false,
            recipe: {
              id: 'r' + i,
              title: 'Danie ' + l,
              servings: 4,
              perServing: { kcal: 1, protein: 1, fat: 1, carbs: 1 },
              cover: null,
              allergens: [],
              myAllergens: [],
            },
          })),
        },
      }),
    );
    await page.route('**/api/assistant/prep', (r) =>
      r.fulfill({
        json: {
          type: 'PREP',
          summary: 'Plan.',
          tips: [],
          dishes: ['A', 'B', 'C', 'D'].map((l, i) => ({
            letter: l,
            cookId: 'c' + i,
            recipeId: 'r' + i,
            title: 'Danie ' + l,
            servings: 4,
            date: '2099-01-01',
          })),
          skipped: [],
          steps: ['A', 'B', 'C', 'D'].map((l, i) => ({
            dish: l,
            index: 1,
            text: 'Krok ' + l,
            timerMinutes: null,
            start: i * 10,
            minutes: 10,
            wait: 30,
            background: 'w tle',
            equipment: 'HOB',
            estimated: true,
          })),
          end: 70,
          handsOn: 40,
          oven: [],
        },
      }),
    );
    await loginUi(page, user);
    for (const theme of ['fresh', 'citrus', 'midnight', 'apricot', 'cinnamon', 'contrast']) {
      await page.evaluate((t) => localStorage.setItem('ck-theme', t), theme);
      await page.goto('/planner/prep?from=2099-01-01');
      await page.getByRole('button', { name: 'Ułóż harmonogram' }).click();
      await expect(page.getByText('Krok D')).toBeVisible();
      await expectNoA11yViolations(page);
    }
  });
});
