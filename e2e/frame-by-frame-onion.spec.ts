/**
 * Frame-by-frame slice 4 (spec 2026-11-07 §Onion skin): with a frame layer targeted and Onion on,
 * the Stage ghosts the whole drawings of the neighbouring keys — the previous key's drawing
 * before, the next key's after — and the single-object ghosts stay out of the way.
 */
import { expect, test } from '@playwright/test';

test('onion skin ghosts the neighbouring drawings of a frame layer', async ({ page }) => {
  await page.goto('/');
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;

  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByLabel('Command search').fill('new frame-by-frame layer');
  await palette.getByLabel('Command search').press('Enter');
  await expect(palette).toBeHidden();

  const drawRect = async (x: number) => {
    await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(box.x + x, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + x + 50, box.y + 150);
    await page.mouse.up();
  };

  // Frame 1: a rect. Frame 3: a blank key with another rect further right.
  await drawRect(100);
  await page.keyboard.press('.');
  await page.keyboard.press('.');
  await page.keyboard.press('F7');
  await drawRect(300);

  await page.getByRole('button', { name: 'Onion', exact: true }).click();
  const before = page.getByTestId('frame-onion-before-0');
  await expect(before).toBeVisible();
  await expect(before.locator('rect')).toHaveCount(1);
  await expect(page.getByTestId('frame-onion-after-0')).toHaveCount(0);
  await expect(page.locator('[data-testid^="onion-ghost-"]')).toHaveCount(0); // whole-drawing mode only

  // Back on frame 1 the later drawing is the "after" ghost.
  await page.keyboard.press(',');
  await page.keyboard.press(',');
  await expect(page.getByTestId('frame-onion-after-0').locator('rect')).toHaveCount(1);
  await expect(page.getByTestId('frame-onion-before-0')).toHaveCount(0);

  // Onion off: no ghosts.
  await page.getByRole('button', { name: 'Onion', exact: true }).click();
  await expect(page.getByTestId('frame-onion-skins')).toHaveCount(0);
});
