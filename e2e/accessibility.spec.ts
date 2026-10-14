import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { createUser, loginUi } from './support/users';

/**
 * Automatyczny audyt WCAG 2.1 AA (axe-core) kluczowych stron,
 * w każdym projekcie (desktop / tablet / telefon) i w każdym motywie.
 * Uwaga: axe wykrywa ok. 50% problemów - reszta to testy ręczne (klawiatura, czytnik ekranu).
 */
const PAGES = [
  '/',
  '/recipes',
  '/how-it-works',
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/legal/privacy',
  '/legal/terms',
  '/nie-ma',
];

/**
 * Motywy: Fresh i Midnight przez ustawienia systemu (tryb Automatyczny), Citrus wybrany ręcznie,
 * Wysoki kontrast przez prefers-contrast: more (też tryb Automatyczny).
 */
const THEMES = [
  { name: 'fresh (auto, jasny system)', colorScheme: 'light', contrast: 'no-preference', stored: null },
  { name: 'midnight (auto, ciemny system)', colorScheme: 'dark', contrast: 'no-preference', stored: null },
  { name: 'citrus (wybrany)', colorScheme: 'light', contrast: 'no-preference', stored: 'citrus' },
  { name: 'apricot (wybrany)', colorScheme: 'light', contrast: 'no-preference', stored: 'apricot' },
  { name: 'cinnamon (wybrany)', colorScheme: 'dark', contrast: 'no-preference', stored: 'cinnamon' },
  { name: 'contrast (auto, prefers-contrast)', colorScheme: 'light', contrast: 'more', stored: null },
] as const;

for (const theme of THEMES) {
  test.describe(`WCAG AA - motyw ${theme.name}`, () => {
    test.use({ colorScheme: theme.colorScheme, contrast: theme.contrast });
    test.beforeEach(async ({ page }) => {
      if (theme.stored) {
        await page.addInitScript((t) => localStorage.setItem('ck-theme', t), theme.stored);
      }
    });

    for (const path of PAGES) {
      test(`${path}`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator('main h1').first()).toBeVisible();
        // Poczekaj na koniec animacji wejścia, żeby axe liczył kontrast na docelowych kolorach
        await page.waitForTimeout(1500);

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();

        expect(
          results.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.map((n) => n.target.join(' ')),
          })),
        ).toEqual([]);
      });
    }
  });
}

test('skip link przenosi fokus do treści', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Tab na telefonie nie dotyczy');
  // Na podstronie - tam <base href> psuł zwykły link "#main"
  await page.goto('/recipes');
  await expect(page.locator('main h1')).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Przejdź do treści' });
  await expect(skip).toBeFocused();
  await skip.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await expect(page).toHaveURL('/recipes');
});

/** Strony po zalogowaniu w motywach innych niż domyślny (domyślny sprawdzają testy funkcji) */
const USER_PAGES = [
  '/planner',
  '/shopping',
  '/pantry',
  '/profile',
  '/settings',
  '/recipes/new',
  '/household',
  '/prices',
];

for (const stored of ['citrus', 'midnight', 'apricot', 'cinnamon', 'contrast'] as const) {
  test(`WCAG AA - strony po zalogowaniu, motyw ${stored}`, async ({ page, request }) => {
    test.slow();
    const user = await createUser(request, 'motyw');
    await page.addInitScript((t) => localStorage.setItem('ck-theme', t), stored);
    await loginUi(page, user);
    for (const path of USER_PAGES) {
      await page.goto(path);
      await expect(page.locator('main h1').first()).toBeVisible();
      await page.waitForTimeout(800);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        results.violations.map((v) => ({ path, id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) })),
      ).toEqual([]);
    }
  });
}
