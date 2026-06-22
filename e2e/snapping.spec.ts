import { test, expect } from '@playwright/test';

test('dragging an object near another snaps its edge and shows a guide', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });

  // Draw rect A (target).
  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 200, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 200);
  await page.mouse.up();

  // Draw rect B (mover), lower-right and not aligned.
  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 520, box.y + 400);
  await page.mouse.down();
  await page.mouse.move(box.x + 620, box.y + 480);
  await page.mouse.up();

  await page.getByRole('button', { name: 'Select' }).click();
  const objects = page.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2);
  const a = objects.nth(0);
  const b = objects.nth(1);
  const aBox = (await a.boundingBox())!;
  const b0 = (await b.boundingBox())!;

  // Begin a drag and measure how far B moves per screen pixel of mouse travel
  // (the SVG is CSS-scaled, so screen px != content px — measure rather than assume).
  const startX = b0.x + b0.width / 2;
  const startY = b0.y + b0.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 80, startY); // probe move left
  const b1 = (await b.boundingBox())!;
  const ratio = (b0.x - b1.x) / 80; // object screen-px moved per mouse screen-px
  expect(ratio).toBeGreaterThan(0.1);

  // Correct the drag so B's left edge reaches A's left edge (then the 6px snap pulls it in).
  const residual = b1.x - aBox.x; // remaining screen gap to close (move further left)
  await page.mouse.move(startX - 80 - residual / ratio, startY - 4);
  await expect(page.getByTestId('snap-guide-x')).toBeAttached(); // guide visible mid-drag
  await page.mouse.up();
  await expect(page.getByTestId('snap-guide-x')).toHaveCount(0); // cleared on release

  const bAfter = (await b.boundingBox())!;
  expect(Math.abs(bAfter.x - aBox.x)).toBeLessThan(3); // left edges snapped into alignment
});
