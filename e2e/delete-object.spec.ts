import { test, expect } from '@playwright/test';

test('delete removes the selected object', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw two rects.
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const rectTool = page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true });
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
  await page.getByRole('button', { name: 'Select' }).click();
  await expect(page.locator('[data-savig-object]')).toHaveCount(2);

  // The last-drawn rect is selected; Delete it via the Inspector button.
  await page.getByRole('button', { name: /^Delete$/ }).click();
  await expect(page.locator('[data-savig-object]')).toHaveCount(1);
});
