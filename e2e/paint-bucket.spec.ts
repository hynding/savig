import { test, expect } from '@playwright/test';

// Paint bucket (spec 2026-11-15-paint-bucket-eraser): the K tool recolours a shape or fills an
// area closed by shapes drawn over it, staying active between clicks.
async function drawRect(page, x1: number, y1: number, x2: number, y2: number) {
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2);
  await page.mouse.up();
}

test('bucket recolours a shape, then fills the ring around a shape drawn over it', async ({ page }) => {
  await page.goto('/');
  // A press on a shape selects it rather than drawing, so draw the small square first, then the
  // big one from empty canvas, and send the big one to the back.
  await drawRect(page, 120, 110, 200, 170); // small
  await drawRect(page, 60, 60, 260, 220); // big (selected)
  const shapes = page.locator('section[aria-label="Stage"] [data-savig-object] > *');
  await expect(shapes).toHaveCount(2);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+BracketLeft' : 'Control+Shift+BracketLeft');

  await page.getByRole('button', { name: 'Paint Bucket', exact: true }).click();
  const color = page.getByLabel('Bucket color');
  await color.fill('#22aa44');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  // Inside the small square: nothing above it, so the square itself is recoloured.
  await page.mouse.click(box.x + 160, box.y + 140);
  await expect(shapes.nth(1)).toHaveAttribute('fill', '#22aa44');
  await expect(shapes).toHaveCount(2);

  // Between the squares: a new fill shape for the ring, and the tool is still the bucket.
  await page.mouse.click(box.x + 80, box.y + 80);
  await expect(shapes).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Paint Bucket', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Open canvas: nothing closed, a toast explains it.
  await page.mouse.click(box.x + 400, box.y + 20);
  await expect(page.getByText(/Nothing closed to fill/)).toBeVisible();
  await expect(shapes).toHaveCount(3);
});
