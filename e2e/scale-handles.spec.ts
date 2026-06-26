import { test, expect } from '@playwright/test';

test('drag a scale corner resizes an imported-svg object', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Import the fixture SVG and instance it (auto-selected).
  await page.getByLabel('Import SVG').setInputFiles('e2e/fixtures/box.svg');
  await page.getByRole('button', { name: 'box.svg', exact: true }).click();
  await page.getByRole('button', { name: 'Select' }).click();

  // Move it into the stage interior so its corner handles are clearly draggable.
  const xField = page.getByLabel('x', { exact: true });
  await xField.fill('150');
  await xField.blur();
  const yField = page.getByLabel('y', { exact: true });
  await yField.fill('120');
  await yField.blur();

  const obj = page.locator('[data-savig-object]').first();
  const before = await obj.getAttribute('transform');
  expect(before).toMatch(/scale\(1, 1\)/);

  // Drag the SE corner outward.
  const handle = page.getByTestId('scale-handle-se');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 60, hb.y + 60);
  await page.mouse.up();

  const after = await obj.getAttribute('transform');
  expect(after).not.toBe(before);
  expect(after).not.toMatch(/scale\(1, 1\)/); // scale changed
});
