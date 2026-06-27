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

test('scaling a group handle snaps the dragged edge to another object + shows a guide', async ({ page }) => {
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

  await drawRect(420, 120, 480, 260); // T (target) — its LEFT edge is the snap line
  await drawRect(80, 150, 120, 210); // B
  await drawRect(150, 150, 190, 210); // C  (B+C form the group to scale)

  await page.getByRole('button', { name: 'Select' }).click();
  const objects = page.locator('[data-savig-object]');
  await expect(objects).toHaveCount(3);
  const t = objects.nth(0);
  const c = objects.nth(2);
  const tBox = (await t.boundingBox())!; // T's left edge = tBox.x (screen)

  // Select B + C -> group handles.
  await objects.nth(1).click();
  await c.click({ modifiers: ['Shift'] });
  const east = page.getByTestId('group-handle-e');
  const hb = (await east.boundingBox())!;

  // Drag the east handle toward T's left edge; aligning the mouse to T's measured screen x maps
  // (same CTM) to T's content-x, so the dragged edge lands within the 6px snap threshold.
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tBox.x, hb.y + hb.height / 2);
  await expect(page.getByTestId('snap-guide-x')).toBeAttached(); // guide while scaling
  await page.mouse.up();
  await expect(page.getByTestId('snap-guide-x')).toHaveCount(0); // cleared on release

  const cAfter = (await c.boundingBox())!;
  expect(Math.abs(cAfter.x + cAfter.width - tBox.x)).toBeLessThan(3); // group's right edge snapped to T's left edge
});

test('resizing a rect edge handle snaps the dragged edge to another object + shows a guide', async ({ page }) => {
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

  await drawRect(420, 120, 480, 260); // T (target) — its LEFT edge is the snap line
  await drawRect(80, 150, 120, 210); // B (the rect we resize rightward)

  await page.getByRole('button', { name: 'Select' }).click();
  const objects = page.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2);
  const t = objects.nth(0);
  const b = objects.nth(1);
  const tBox = (await t.boundingBox())!; // T's left edge = tBox.x (screen)

  // Select B alone -> resize handles. Drag the east (right-edge) handle toward T's left edge;
  // aligning the mouse to T's measured screen x maps (same CTM) to T's content-x, so B's right
  // edge lands within the 6px snap threshold.
  await b.click();
  const east = page.getByTestId('handle-e');
  const hb = (await east.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tBox.x, hb.y + hb.height / 2);
  await expect(page.getByTestId('snap-guide-x')).toBeAttached(); // guide while resizing
  await page.mouse.up();
  await expect(page.getByTestId('snap-guide-x')).toHaveCount(0); // cleared on release

  const bAfter = (await b.boundingBox())!;
  expect(Math.abs(bAfter.x + bAfter.width - tBox.x)).toBeLessThan(3); // B's right edge snapped to T's left edge
});
