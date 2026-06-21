import { test, expect } from '@playwright/test';

test('duplicate creates a second, selected object', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect (it is selected).
  await page.getByRole('button', { name: 'Rectangle' }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 180);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Select' }).click();
  await expect(page.locator('[data-savig-object]')).toHaveCount(1);

  // Duplicate via the Inspector button.
  await page.getByRole('button', { name: /duplicate/i }).click();
  await expect(page.locator('[data-savig-object]')).toHaveCount(2);
  // Exactly one object is selected, and it is the duplicate (data-selected="true").
  await expect(page.locator('[data-savig-object][data-selected="true"]')).toHaveCount(1);
});
