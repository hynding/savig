import { test, expect } from '@playwright/test';

test('drag the rotate handle rotates the object', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect, then switch to the select tool.
  await page.getByRole('button', { name: 'Rectangle' }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 200);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Select' }).click();

  const obj = page.locator('[data-savig-object]').first();
  const before = await obj.getAttribute('transform');

  // Drag the rotate handle in an arc around the object.
  const handle = page.getByTestId('rotate-handle');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 80, hb.y + 80); // sweep to the side
  await page.mouse.up();

  const after = await obj.getAttribute('transform');
  expect(after).not.toBe(before);
  expect(after).toMatch(/rotate\(/);
  // The rotate angle is non-zero (not "rotate(0, ...").
  expect(after).not.toMatch(/rotate\(0,/);
});
