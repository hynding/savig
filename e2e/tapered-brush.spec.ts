import { test, expect } from '@playwright/test';

test('tapered brush: Taper in/out bake a filled, closed outline (no stroke)', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Brush', exact: true }).click();

  // Range inputs: Playwright's fill() rejects input[type=range]. Both taper fields
  // start at 0 (store-internals default) with step=5, so focus + 6x ArrowRight lands
  // exactly on 30 — no click-to-position ambiguity.
  const taperIn = page.getByLabel('Taper in', { exact: true });
  await taperIn.focus();
  for (let i = 0; i < 6; i++) await taperIn.press('ArrowRight');
  await expect(taperIn).toHaveValue('30');

  const taperOut = page.getByLabel('Taper out', { exact: true });
  await taperOut.focus();
  for (let i = 0; i < 6; i++) await taperOut.press('ArrowRight');
  await expect(taperOut).toHaveValue('30');

  // Draw the same zigzag gesture as e2e/brush.spec.ts.
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const x0 = box.x + 100;
  const y0 = box.y + 160;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 40, y0 - 40);
  await page.mouse.move(x0 + 80, y0 + 20);
  await page.mouse.move(x0 + 120, y0 - 20);
  await page.mouse.up();

  const objects = page.locator('section[aria-label="Stage"] [data-savig-object]');
  await expect(objects).toHaveCount(1);

  const shape = objects.first().locator('path').first();
  const fill = await shape.getAttribute('fill');
  expect(fill).not.toBeNull();
  expect(fill).not.toBe('none');
  const stroke = await shape.getAttribute('stroke');
  expect(stroke === null || stroke === 'none').toBe(true);
  const d = await shape.getAttribute('d');
  expect(d).not.toBeNull();
  expect(d).toContain('Z');
});
