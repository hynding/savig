import { test, expect } from '@playwright/test';

test('Alt-dragging a scale corner scales the object about its centre', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  await page.getByLabel('Import SVG').setInputFiles('e2e/fixtures/box.svg');
  await page.getByRole('button', { name: 'box.svg', exact: true }).click();
  await page.getByRole('button', { name: 'Select' }).click();

  const obj = page.locator('[data-savig-object]').first();
  const before = (await obj.boundingBox())!;
  const centreBefore = { x: before.x + before.width / 2, y: before.y + before.height / 2 };

  // Alt-drag the SE corner outward: the object must grow about its centre
  // (centre stays put) rather than keeping the opposite corner fixed.
  const handle = page.getByTestId('scale-handle-se');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 60, hb.y + hb.height / 2 + 60);
  await page.mouse.up();
  await page.keyboard.up('Alt');

  const after = (await obj.boundingBox())!;
  const centreAfter = { x: after.x + after.width / 2, y: after.y + after.height / 2 };

  expect(after.width).toBeGreaterThan(before.width + 10); // it grew
  expect(after.height).toBeGreaterThan(before.height + 10);
  expect(centreAfter.x).toBeCloseTo(centreBefore.x, 0); // centre unchanged (~1px)
  expect(centreAfter.y).toBeCloseTo(centreBefore.y, 0);
});
