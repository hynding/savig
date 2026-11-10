/**
 * Frame-by-frame slice 2 (spec 2026-11-07): the F-key workflow in the real editor — create a
 * frame layer from the palette, draw into its first key, step a frame, F6 to copy the drawing,
 * F7 for a blank key, and confirm F5 holds the drawing without reloading the page.
 */
import { expect, test } from '@playwright/test';

test('palette → draw → F6 / F7 / F5 swap drawings on the Stage', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => ((window as unknown as { __fbfMarker: boolean }).__fbfMarker = true));

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const objects = page.locator('section[aria-label="Stage"] [data-savig-object]');
  const visible = page.locator('section[aria-label="Stage"] [data-savig-object][visibility="visible"]');

  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByLabel('Command search').fill('new frame-by-frame layer');
  await palette.getByLabel('Command search').press('Enter');
  await expect(palette).toBeHidden();

  // Draw into key 1 (the new layer is selected, so the stroke lands in it).
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 160);
  await page.mouse.up();
  await expect(objects).toHaveCount(1);
  await expect(visible).toHaveCount(1);

  // Next frame, F6: a copy of the drawing in a new key — two nodes, only the copy on screen.
  await page.keyboard.press('.');
  await page.keyboard.press('F6');
  await expect(objects).toHaveCount(2);
  await expect(visible).toHaveCount(1);

  // Next frame, F7: a blank key — nothing on screen.
  await page.keyboard.press('.');
  await page.keyboard.press('F7');
  await expect(visible).toHaveCount(0);

  // Back to frame 0: the original drawing returns.
  await page.keyboard.press(',');
  await page.keyboard.press(',');
  await expect(visible).toHaveCount(1);

  // F5 holds the drawing instead of reloading the page (the marker survives).
  await page.keyboard.press('F5');
  expect(await page.evaluate(() => (window as unknown as { __fbfMarker?: boolean }).__fbfMarker)).toBe(true);
});
