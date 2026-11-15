import { test, expect } from '@playwright/test';

// Eraser (spec 2026-11-15-paint-bucket-eraser): the X tool cuts the dragged sweep out of shapes.
test('eraser drag cuts a rectangle in two; undo restores it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 160);
  await page.mouse.up();
  const shape = page.locator('section[aria-label="Stage"] [data-savig-object] > *').first();
  await expect(shape).toHaveCount(1);
  expect(await shape.evaluate((el) => el.tagName)).toBe('rect');

  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await page.getByLabel('Eraser size').fill('12');
  await page.mouse.move(box.x + 160, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 110, { steps: 5 });
  await expect(page.getByTestId('eraser-preview')).toHaveAttribute('visibility', 'visible');
  await page.mouse.move(box.x + 160, box.y + 190, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('eraser-preview')).toHaveAttribute('visibility', 'hidden');

  // Now a path with two pieces (even-odd compound) instead of a rect.
  const cut = page.locator('section[aria-label="Stage"] [data-savig-object] > *').first();
  await expect.poll(() => cut.evaluate((el) => el.tagName)).toBe('path');
  expect((await cut.getAttribute('d'))!.match(/M/g)!.length).toBe(2);

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect.poll(() => page.locator('section[aria-label="Stage"] [data-savig-object] > *').first().evaluate((el) => el.tagName)).toBe('rect');
});
