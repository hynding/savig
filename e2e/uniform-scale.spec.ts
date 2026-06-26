import { test, expect } from '@playwright/test';

test('shift-dragging a scale corner keeps the aspect ratio', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  await page.getByLabel('Import SVG').setInputFiles('e2e/fixtures/box.svg');
  await page.getByRole('button', { name: 'box.svg', exact: true }).click();
  await page.getByRole('button', { name: 'Select' }).click();

  const xField = page.getByLabel('x', { exact: true });
  await xField.fill('150');
  await xField.blur();
  const yField = page.getByLabel('y', { exact: true });
  await yField.fill('120');
  await yField.blur();

  const obj = page.locator('[data-savig-object]').first();

  // Shift-drag the SE corner along an OFF-diagonal path; aspect must stay square.
  const handle = page.getByTestId('scale-handle-se');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 80, hb.y + hb.height / 2 + 30); // off-diagonal
  await page.mouse.up();
  await page.keyboard.up('Shift');

  const after = await obj.getAttribute('transform');
  // scale(k, k) with EQUAL factors (aspect preserved), and not scale(1, 1).
  const m = after!.match(/scale\(([-\d.]+),\s*([-\d.]+)\)/)!;
  expect(Number(m[1])).toBeCloseTo(Number(m[2]), 2);
  expect(Number(m[1])).not.toBeCloseTo(1, 2);
});
