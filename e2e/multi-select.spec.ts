import { test, expect } from '@playwright/test';

test('shift-click multi-selects two objects and Delete removes both', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });

  const drawRect = async (x0: number, y0: number, x1: number, y1: number) => {
    await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.up();
  };

  await drawRect(120, 100, 220, 180); // A
  await drawRect(380, 300, 480, 380); // B

  const objects = page.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2);

  // Single-select A, then Shift-click B to add it.
  await objects.nth(0).click();
  await objects.nth(1).click({ modifiers: ['Shift'] });
  await expect(page.locator('[data-testid^="selection-outline-"]')).toHaveCount(2); // both outlined

  await page.keyboard.press('Delete');
  await expect(objects).toHaveCount(0); // bulk delete removed both
});
