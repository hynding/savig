import { test, expect } from '@playwright/test';

test('drag a linear gradient end handle reshapes the gradient', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect.
  await page.getByRole('button', { name: 'Rectangle' }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + 200);
  await page.mouse.up();

  // Back to the select tool, assign a linear fill gradient.
  await page.getByRole('button', { name: 'Select' }).click();
  await page.getByLabel('fill paint').selectOption('linear');

  // The gradient handles are now visible. Read the live linearGradient x2 before/after.
  const grad = page.locator('linearGradient').first();
  const x2Before = await grad.getAttribute('x2');

  const endHandle = page.getByTestId('gradient-handle-end');
  const hb = (await endHandle.boundingBox())!;
  // Drag the end handle to the left by ~60px.
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 - 60, hb.y + hb.height / 2);
  await page.mouse.up();

  const x2After = await grad.getAttribute('x2');
  expect(x2After).not.toBe(x2Before); // the gradient geometry changed
});
