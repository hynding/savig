import { test, expect, type Page } from '@playwright/test';

/** Color swatches (roadmap 12): save a swatch, make it global, paint two shapes with it, then
 *  recolor both at once by editing the swatch; undo restores them. */
async function drawRect(page: Page, x: number, y: number) {
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const box = (await page.locator('section[aria-label="Stage"] svg').first().boundingBox())!;
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 80, box.y + y + 60);
  await page.mouse.up();
}

test('a global swatch recolors every shape painted with it', async ({ page }) => {
  await page.goto('/');
  const panel = page.locator('[aria-label="Swatches"]');
  const stage = page.locator('section[aria-label="Stage"]');
  const rects = stage.locator('[data-savig-object] rect');

  await drawRect(page, 40, 40);
  await drawRect(page, 200, 40);
  await expect(rects).toHaveCount(2);

  // Save a swatch (seeded from the selected fill), recolor it, and make it global.
  await panel.getByTestId('swatch-add').click();
  await panel.getByTestId('swatch-color').fill('#2266cc');
  await panel.getByTestId('swatch-global').check();
  await panel.getByTestId('swatch-name').fill('Brand');
  await panel.getByTestId('swatch-name').press('Enter');
  const chip = panel.locator('[data-testid^="swatch-"][data-global="true"]');
  await expect(chip).toHaveAttribute('aria-label', 'swatch Brand');

  // Paint both shapes: the selected one, then the other via the Layers panel.
  await chip.click();
  const layers = page.locator('[aria-label="Layers"] [data-testid^="layer-"]');
  await layers.nth(1).click();
  await chip.click();
  await expect(rects.nth(0)).toHaveAttribute('fill', '#2266cc');
  await expect(rects.nth(1)).toHaveAttribute('fill', '#2266cc');
  await expect(panel.getByTestId('swatch-usage')).toHaveText('2 linked');
  await expect(page.getByTestId('fill-swatch-link')).toContainText('Brand');

  // Editing the global swatch recolors both; undo puts them back.
  await panel.getByTestId('swatch-color').fill('#cc3311');
  await expect(rects.nth(0)).toHaveAttribute('fill', '#cc3311');
  await expect(rects.nth(1)).toHaveAttribute('fill', '#cc3311');
  await stage.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(rects.nth(0)).toHaveAttribute('fill', '#2266cc');
  await expect(rects.nth(1)).toHaveAttribute('fill', '#2266cc');
});
