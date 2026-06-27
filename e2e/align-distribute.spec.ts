import { test, expect } from '@playwright/test';

test('align three rects to a top edge, then distribute them horizontally', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });

  const drawRect = async (x0: number, y0: number, x1: number, y1: number) => {
    await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.up();
  };

  // Three rects at different x AND y (so both align and distribute have work to do).
  await drawRect(100, 120, 150, 160); // A
  await drawRect(250, 60, 300, 100); // B
  await drawRect(430, 200, 480, 240); // C

  const objects = page.locator('[data-savig-object]');
  await expect(objects).toHaveCount(3);
  const a = objects.nth(0);
  const b = objects.nth(1);
  const c = objects.nth(2);

  // Select all three.
  await a.click();
  await b.click({ modifiers: ['Shift'] });
  await c.click({ modifiers: ['Shift'] });

  // Align top -> the three top edges line up.
  await page.getByRole('button', { name: 'Align top', exact: true }).click();
  const tops = [(await a.boundingBox())!.y, (await b.boundingBox())!.y, (await c.boundingBox())!.y];
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(2);

  // Distribute horizontally -> equal gaps between consecutive boxes (sorted by x).
  await page.getByRole('button', { name: 'Distribute horizontally', exact: true }).click();
  const boxes = (await Promise.all([a, b, c].map((o) => o.boundingBox()))).map((bb) => bb!);
  boxes.sort((p, q) => p.x - q.x);
  const gap1 = boxes[1].x - (boxes[0].x + boxes[0].width);
  const gap2 = boxes[2].x - (boxes[1].x + boxes[1].width);
  expect(Math.abs(gap1 - gap2)).toBeLessThan(2);
});

test('align a single object to the canvas RIGHT edge, then back to the LEFT edge', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });

  // Draw a small rect near the left; it stays selected (single-object panel).
  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 120, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 160);
  await page.mouse.up();
  const rect = page.locator('[data-savig-object]').first();

  const x0 = (await rect.boundingBox())!.x;
  await page.getByRole('button', { name: 'Align right to canvas', exact: true }).click();
  const xRight = (await rect.boundingBox())!.x;
  expect(xRight).toBeGreaterThan(x0 + 50); // moved toward the right edge

  await page.getByRole('button', { name: 'Align left to canvas', exact: true }).click();
  const xLeft = (await rect.boundingBox())!.x;
  expect(xLeft).toBeLessThan(xRight - 50); // moved back toward the left edge
});
