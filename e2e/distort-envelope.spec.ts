import { test, expect } from '@playwright/test';

// Distort / Envelope (spec 2026-11-18-skew-distort, slice 3): the Inspector's Free transform
// buttons put pins on the drawing; dragging one bakes the warp into the outline in one undo step.
async function drawRect(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 150);
  await page.mouse.up();
}

async function dragHandle(page: import('@playwright/test').Page, testId: string, dx: number, dy: number) {
  const h = (await page.getByTestId(testId).boundingBox())!;
  const x = h.x + h.width / 2;
  const y = h.y + h.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 3 });
  await page.mouse.move(x + dx, y + dy, { steps: 3 });
  await expect(page.getByTestId('warp-preview')).toHaveCount(1);
  await page.mouse.up();
}

test('Distort drags one corner of a rectangle; undo puts the rectangle back', async ({ page }) => {
  await drawRect(page);
  const shape = page.locator('section[aria-label="Stage"] [data-savig-object]').first();
  await expect(shape.locator('rect')).toHaveCount(1);
  const before = (await shape.boundingBox())!;

  await page.getByRole('button', { name: 'Distort', exact: true }).click();
  await expect(page.getByTestId('warp-distort')).toBeVisible();
  await expect(page.getByTestId('scale-handles')).toHaveCount(0);
  await dragHandle(page, 'warp-handle-2', 40, 30); // bottom-right corner

  const warped = page.locator('section[aria-label="Stage"] [data-savig-object]').first();
  await expect(warped.locator('path')).toHaveCount(1);
  await expect(warped.locator('rect')).toHaveCount(0);
  const after = (await warped.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width + 30);
  expect(after.x).toBeCloseTo(before.x, 0); // the top-left corner stayed put

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('warp-distort')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object]').first().locator('rect')).toHaveCount(1);
});

test('Envelope bulges the top edge with the top-middle mesh handle', async ({ page }) => {
  await drawRect(page);
  const shape = page.locator('section[aria-label="Stage"] [data-savig-object]').first();
  const before = (await shape.boundingBox())!;
  await page.getByRole('button', { name: 'Envelope', exact: true }).click();
  await expect(page.getByTestId('warp-handle-8')).toBeVisible();
  await dragHandle(page, 'warp-handle-1', 0, -40);
  const warped = page.locator('section[aria-label="Stage"] [data-savig-object]').first();
  await expect(warped.locator('path')).toHaveCount(1);
  await expect(warped.locator('rect')).toHaveCount(0);
  const after = (await warped.boundingBox())!;
  expect(after.y).toBeLessThan(before.y - 10); // the top bowed upward
  expect(after.y + after.height).toBeCloseTo(before.y + before.height, 0); // the bottom didn't move
});
