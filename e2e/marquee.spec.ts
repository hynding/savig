import { test, expect } from '@playwright/test';

test('marquee-dragging the background selects the enclosed objects', async ({ page }) => {
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

  await drawRect(140, 110, 210, 170); // A
  await drawRect(380, 290, 450, 350); // B

  const objects = page.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2);

  // Marquee from an empty corner (80,70) across both rects.
  await page.getByRole('button', { name: 'Select' }).click();
  await page.mouse.move(box.x + 80, box.y + 70);
  await page.mouse.down();
  await page.mouse.move(box.x + 520, box.y + 410);
  await expect(page.getByTestId('marquee')).toBeAttached(); // rubber-band visible mid-drag
  await page.mouse.up();

  await expect(page.locator('[data-testid^="selection-outline-"]')).toHaveCount(2); // both selected
  await expect(page.getByTestId('marquee')).toHaveCount(0); // cleared on release

  await page.keyboard.press('Delete');
  await expect(objects).toHaveCount(0); // bulk delete the marquee selection
});
