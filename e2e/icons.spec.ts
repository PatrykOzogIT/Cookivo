// Każda ikona z core/icons.json renderuje się z okrojonego fontu (scripts/icons.mjs) - świeża przeglądarka, bez cache
import { expect, test } from '@playwright/test';
import icons from '../frontend/src/app/core/icons.json' with { type: 'json' };

test('wszystkie ikony z listy są w foncie', async ({ page }) => {
  await page.goto('/recipes');
  const bad = await page.evaluate(async (names) => {
    await document.fonts.load('24px "Material Symbols Rounded"');
    const box = document.createElement('div');
    document.body.append(box);
    const out: string[] = [];
    for (const n of names) {
      const s = document.createElement('span');
      s.className = 'material-symbols-rounded';
      s.style.cssText = 'width:auto;height:auto;overflow:visible;font-size:24px';
      s.textContent = n;
      box.append(s);
      if (s.offsetWidth > 30) out.push(`${n}:${s.offsetWidth}`);
    }
    return out;
  }, icons as string[]);
  expect(bad).toEqual([]);
});
