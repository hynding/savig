import { test, expect } from '@playwright/test';

test('drag the rotate handle rotates an imported-svg object', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Import the fixture SVG and instance it (auto-selected).
  await page.getByLabel('Import SVG').setInputFiles('e2e/fixtures/box.svg');
  await page.getByRole('button', { name: 'box.svg', exact: true }).click();
  await page.getByRole('button', { name: 'Select' }).click();

  // Move it into the stage interior (it instances at 0,0 — top-left corner — where the
  // rotate handle would sit behind the chrome) so the handle is clearly draggable.
  const xField = page.getByLabel('x', { exact: true });
  await xField.fill('150');
  await xField.blur();
  const yField = page.getByLabel('y', { exact: true });
  await yField.fill('120');
  await yField.blur();

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
  expect(after).not.toMatch(/rotate\(0,/); // a non-zero angle
});
