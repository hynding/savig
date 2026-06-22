import { test, expect } from '@playwright/test';

test('Cmd+C then Cmd+V copies and pastes the whole multi-selection', async ({ page }) => {
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

  await drawRect(120, 100, 200, 170); // A
  await drawRect(380, 280, 460, 350); // B

  const objects = page.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2);

  // Select both, then copy + paste.
  await objects.nth(0).click();
  await objects.nth(1).click({ modifiers: ['Shift'] });
  await page.keyboard.press('ControlOrMeta+KeyC');
  await page.keyboard.press('ControlOrMeta+KeyV');

  await expect(objects).toHaveCount(4); // two pasted clones
  // The two clones are now the selection (exactly two outlines).
  await expect(page.locator('[data-testid^="selection-outline-"]')).toHaveCount(2);
});
