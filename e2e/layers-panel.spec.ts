import { test, expect } from '@playwright/test';

test('layers panel selects an object and toggles its visibility', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw two rects.
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const rectTool = page
    .getByRole('group', { name: 'Tools' })
    .getByRole('button', { name: 'Rectangle', exact: true });
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
  await expect(page.locator('[data-savig-object]')).toHaveCount(2);

  // The Layers panel lists both; toggle the visibility of the first-listed (front) object.
  const rows = page.locator('section[aria-label="Assets"] [data-testid^="layer-"]');
  await expect(rows).toHaveCount(2);
  const firstId = await rows.first().getAttribute('data-testid'); // "layer-<id>"
  const objId = firstId!.replace('layer-', '');
  await page.getByTestId(`vis-${objId}`).click();

  // One fewer object renders; toggling again restores it.
  await expect(page.locator('[data-savig-object]')).toHaveCount(1);
  await page.getByTestId(`vis-${objId}`).click();
  await expect(page.locator('[data-savig-object]')).toHaveCount(2);
});
