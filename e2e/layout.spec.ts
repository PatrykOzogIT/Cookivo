import { expect, test } from '@playwright/test';

test.describe('Układ i nawigacja', () => {
  test('menu: poziome na desktopie/tablecie, dolny pasek na telefonie', async ({ page, isMobile }) => {
    await page.goto('/');
    const [top, bottom] = [page.locator('.main-nav'), page.locator('.bottom-nav')];
    if (isMobile) {
      await expect(top).toBeHidden();
      await expect(bottom).toBeVisible();
    } else {
      await expect(top).toBeVisible();
      await expect(bottom).toBeHidden();
    }
  });

  test('brak poziomego przewijania strony', async ({ page }) => {
    for (const path of ['/', '/recipes', '/auth/register']) {
      await page.goto(path);
      await expect(page.locator('main h1').first()).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test('filtry: panel z lewej albo wysuwany od dołu na telefonie', async ({ page, isMobile }) => {
    await page.goto('/recipes');
    const filters = page.getByRole('complementary', { name: 'Filtry' });
    if (isMobile) {
      await expect(filters).toBeHidden();
      const toggle = page.getByRole('button', { name: /Filtry/ }).first();
      await toggle.click();
      await expect(filters).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('button', { name: 'Zamknij' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(filters).toBeHidden();
      await expect(toggle).toBeFocused();
    } else {
      await expect(filters).toBeVisible();
      // Panel nie może przejmować fokusu przy wejściu na stronę
      await expect(page.locator('main h1')).toBeVisible();
      expect(await page.evaluate(() => document.activeElement?.closest('aside'))).toBeNull();
    }
  });

  test('przełączanie języka i motywu jest zapamiętywane', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Switch to English' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Eat well');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.getByRole('button', { name: 'Theme: Automatic' }).click();
    await expect(page.getByRole('menuitemradio', { name: /Automatic/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.getByRole('menuitemradio', { name: 'Midnight Mango' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight');
    await expect(page.getByRole('button', { name: 'Theme: Midnight Mango' })).toBeVisible();

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Eat well');
  });

  test('dawny wybór jasny/ciemny przechodzi na nowe motywy', async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('ck-test-init')) {
        localStorage.setItem('ck-theme', 'dark');
        sessionStorage.setItem('ck-test-init', '1');
      }
    });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'cinnamon');
    expect(await page.evaluate(() => localStorage.getItem('ck-theme'))).toBe('cinnamon');
  });

  test('cele dotykowe mają co najmniej 44 px', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Sprawdzamy na telefonie');
    await page.goto('/auth/login');
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('main button, main a, .bottom-nav a, header button')]
        .filter((el) => el.offsetParent !== null)
        .map((el) => ({ el: el.textContent?.trim().slice(0, 30), ...el.getBoundingClientRect().toJSON() }))
        .filter((r) => r.height < 44 && r.width < 44),
    );
    expect(small).toEqual([]);
  });
});
