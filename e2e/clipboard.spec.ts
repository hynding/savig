import { test, expect } from '@playwright/test';

test('copy and paste an object via the keyboard', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect (auto-selected).
  await page
    .getByRole('group', { name: 'Tools' })
    .getByRole('button', { name: 'Rectangle', exact: true })
    .click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 160);
  await page.mouse.up();
  await expect(page.locator('[data-savig-object]')).toHaveCount(1);

  // Copy + paste. ControlOrMeta = Cmd on macOS, Ctrl elsewhere.
  await page.keyboard.press('ControlOrMeta+KeyC');
  await page.keyboard.press('ControlOrMeta+KeyV');

  await expect(page.locator('[data-savig-object]')).toHaveCount(2);
});
