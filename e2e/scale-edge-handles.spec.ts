import { test, expect } from '@playwright/test';

test('drag the E edge scale handle stretches an imported-svg on one axis', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  await page.getByLabel('Import SVG').setInputFiles('e2e/fixtures/box.svg');
  await page.getByRole('button', { name: 'box.svg' }).click();
  await page.getByRole('button', { name: 'Select' }).click();

  // Move it into the stage interior so the edge handle is clearly draggable.
  const xField = page.getByLabel('x', { exact: true });
  await xField.fill('150');
  await xField.blur();
  const yField = page.getByLabel('y', { exact: true });
  await yField.fill('120');
  await yField.blur();

  const obj = page.locator('[data-savig-object]').first();
  const before = await obj.getAttribute('transform');
  expect(before).toMatch(/scale\(1, 1\)/);

  // Drag the right-edge (E) handle outward.
  const handle = page.getByTestId('scale-handle-e');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 60, hb.y + hb.height / 2);
  await page.mouse.up();

  const after = await obj.getAttribute('transform');
  expect(after).not.toBe(before);
  expect(after).toMatch(/scale\([^,]+, 1\)/); // X changed, Y still 1 (single-axis)
  expect(after).not.toMatch(/scale\(1, 1\)/);
});
