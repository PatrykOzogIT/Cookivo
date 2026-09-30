import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Automatyczny audyt WCAG 2.1 AA (axe-core) kluczowych stron,
 * w każdym projekcie (desktop / tablet / telefon) i w obu motywach.
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
  '/nie-ma',
];

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`WCAG AA - motyw ${scheme}`, () => {
    test.use({ colorScheme: scheme });

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
