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

test('paste places the copy under the cursor when the pointer is over the Stage', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 150);
  await page.mouse.up();

  await page.keyboard.press('ControlOrMeta+KeyC');
  // Move the pointer to a distinct empty spot, then paste -> the copy centres there.
  const target = { x: box.x + 420, y: box.y + 300 };
  await page.mouse.move(target.x, target.y);
  await page.keyboard.press('ControlOrMeta+KeyV');

  const objs = page.locator('section[aria-label="Stage"] [data-savig-object]');
  await expect(objs).toHaveCount(2);
  const boxes = (await Promise.all([objs.nth(0), objs.nth(1)].map((o) => o.boundingBox()))).map((b) => b!);
  const centres = boxes.map((b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 }));
  const near = centres.some((c) => Math.abs(c.x - target.x) < 25 && Math.abs(c.y - target.y) < 25);
  expect(near).toBe(true); // one of the two objects sits at the cursor
});
