import { test, expect } from '@playwright/test';

test('drag a layer row to reorder objects', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw two rects: the second-drawn is front-most, so it is the FIRST (top) row.
  const rectTool = page
    .getByRole('group', { name: 'Tools' })
    .getByRole('button', { name: 'Rectangle', exact: true });
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  for (const [dx, dy] of [
    [60, 60],
    [200, 160],
  ]) {
    await rectTool.click();
    await page.mouse.move(box.x + dx, box.y + dy);
    await page.mouse.down();
    await page.mouse.move(box.x + dx + 80, box.y + dy + 60);
    await page.mouse.up();
  }

  const rows = page.locator('section[aria-label="Assets"] [data-testid^="layer-"]');
  await expect(rows).toHaveCount(2);
  const topId = (await rows.nth(0).getAttribute('data-testid'))!; // front-most (second-drawn)
  const bottomRow = rows.nth(1); // back (first-drawn)
  const bottomId = (await bottomRow.getAttribute('data-testid'))!;

  // Drag the bottom (back) row UP onto the top (front) row -> the back object becomes front.
  await bottomRow.dragTo(rows.nth(0));

  // The first row is now the previously-bottom object.
  await expect(rows.nth(0)).toHaveAttribute('data-testid', bottomId);
  await expect(rows.nth(1)).toHaveAttribute('data-testid', topId);
});
