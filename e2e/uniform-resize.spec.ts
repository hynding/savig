import { test, expect } from '@playwright/test';

test('shift-dragging a resize corner keeps the rect aspect ratio', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a non-square rect (auto-selected), then switch to the select tool.
  await page
    .getByRole('group', { name: 'Tools' })
    .getByRole('button', { name: 'Rectangle', exact: true })
    .click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 280, box.y + 200); // 200 x 120 rect
  await page.mouse.up();
  await page.getByRole('button', { name: 'Select' }).click();

  const shape = page.locator('[data-savig-object] rect').first();
  const w0 = Number(await shape.getAttribute('width'));
  const h0 = Number(await shape.getAttribute('height'));

  // Shift-drag the SE resize handle along an OFF-diagonal path; aspect must stay constant.
  const handle = page.getByTestId('handle-se');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 90, hb.y + hb.height / 2 + 20); // off-diagonal
  await page.mouse.up();
  await page.keyboard.up('Shift');

  const w1 = Number(await shape.getAttribute('width'));
  const h1 = Number(await shape.getAttribute('height'));
  expect(w1).not.toBeCloseTo(w0, 1); // it resized
  expect(w1 / h1).toBeCloseTo(w0 / h0, 2); // aspect preserved
});
