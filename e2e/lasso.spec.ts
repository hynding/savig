import { test, expect, type Page } from '@playwright/test';

// Lasso (spec 2026-11-18-lasso): a freehand loop over part of the selected rectangle cuts that
// part into its own drawing; a polygon loop selects what it touches; Esc cancels a polygon.
async function setup(page: Page) {
  await page.goto('/');
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 220, { steps: 3 });
  await page.mouse.up();
  return box;
}
const objects = (page: Page) => page.locator('section[aria-label="Stage"] [data-savig-object]');

test('freehand lasso cuts the looped part of the selected rectangle; undo restores it', async ({ page }) => {
  const box = await setup(page);
  await expect(objects(page)).toHaveCount(1);
  await page.keyboard.press('q');
  await expect(page.getByRole('button', { name: 'Lasso', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Freehand lasso', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // A loop around the left part of the rectangle (it stays selected after drawing).
  const pts = [[60, 80], [180, 80], [180, 250], [60, 250], [60, 85]];
  await page.mouse.move(box.x + pts[0][0], box.y + pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(box.x + x, box.y + y, { steps: 4 });
  await expect(page.getByTestId('lasso-preview')).toBeVisible();
  await page.mouse.up();

  await expect(objects(page)).toHaveCount(2);
  await expect(page.getByTestId('lasso-preview')).toBeHidden();
  const piece = page.locator('section[aria-label="Stage"] [data-savig-object][data-selected="true"]');
  await expect(piece).toHaveCount(1);
  const pb = (await piece.boundingBox())!;
  expect(pb.x + pb.width).toBeLessThan(box.x + 185);

  await page.keyboard.press('ControlOrMeta+z');
  await expect(objects(page)).toHaveCount(1);
});

test('polygon lasso selects what it touches; Esc cancels a loop', async ({ page }) => {
  const box = await setup(page);
  await page.keyboard.press('q');
  await page.getByRole('button', { name: 'Polygon lasso', exact: true }).click();
  // Deselect by starting and cancelling a loop far away.
  await page.mouse.click(box.x + 400, box.y + 300);
  await page.mouse.click(box.x + 450, box.y + 330);
  await expect(page.getByTestId('lasso-preview')).toHaveAttribute('visibility', 'visible');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('lasso-preview')).toHaveAttribute('visibility', 'hidden');
  await expect(objects(page)).toHaveCount(1);

  // A loop that misses everything clears the selection.
  for (const [x, y] of [[400, 300], [450, 300], [450, 350], [400, 300]]) await page.mouse.click(box.x + x, box.y + y);
  await expect(page.locator('[data-savig-object][data-selected="true"]')).toHaveCount(0);

  // A loop crossing the rectangle's corner selects it (nothing selected, so no cut).
  for (const [x, y] of [[240, 200], [320, 200], [320, 280], [240, 280], [240, 200]]) await page.mouse.click(box.x + x, box.y + y);
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object][data-selected="true"]')).toHaveCount(1);
  await expect(objects(page)).toHaveCount(1);
});
