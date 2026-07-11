import { test, expect } from '@playwright/test';

test('scissors splits an open path (Line tool) into two objects; undo pins back to one', async ({ page }) => {
  await page.goto('/');

  // The Line tool commits a 2-node OPEN vector path (linePath -> closed: false) via
  // addVectorPath, which auto-selects the new object and switches the active tool to Node
  // (see packages/engine/src/primitives.ts linePath + editor-state addVectorPath). So the
  // object is already selected by the time we arm scissors -- no separate select-tool click
  // needed, and (per Stage.test.tsx's scissors suite) a click on an ALREADY-selected path's
  // segment cuts on the very first press, since the object-local overlay CTM is already live.
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + 80);
  await page.mouse.up();

  const stageObjects = page.locator('section[aria-label="Stage"] [data-savig-object]');
  await expect(stageObjects).toHaveCount(1);
  // Confirms the line is selected (Inspector shows the path's node-count readout).
  await expect(page.getByText(/nodes:/i)).toBeVisible();

  // Arm scissors and cut at the segment's midpoint -- straight segment, so screen-space
  // midpoint IS the curve-t 0.5 hit point.
  await page.keyboard.press('c');
  await page.mouse.click(box.x + 160, box.y + 80);
  await expect(stageObjects).toHaveCount(2);

  // Single-commit pin: one undo restores the pre-cut object.
  await page.keyboard.press('ControlOrMeta+KeyZ');
  await expect(stageObjects).toHaveCount(1);
});

test('scissors opens a closed pen path in place (still one object, d loses Z)', async ({ page }) => {
  await page.goto('/');

  // Draw a closed triangle with the pen: three anchors, then close by clicking back near the
  // first anchor (Stage.tsx's onBackgroundPointerDown pen branch: nearFirstAnchor with >= 2
  // nodes drawn closes via finishPen(true)), mirroring draw-path.spec.ts's open-path pen flow.
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.click(box.x + 80, box.y + 80);
  await page.mouse.click(box.x + 240, box.y + 80);
  await page.mouse.click(box.x + 160, box.y + 200);
  await page.mouse.click(box.x + 80, box.y + 80); // close: click back on the first anchor

  const stageObjects = page.locator('section[aria-label="Stage"] [data-savig-object]');
  await expect(stageObjects).toHaveCount(1);
  await expect(page.getByText(/nodes:/i)).toBeVisible();

  const pathEl = stageObjects.locator('path').first();
  const dBefore = await pathEl.getAttribute('d');
  expect(dBefore).toContain('Z');

  // The closed path is already selected (finishPen(true) -> addVectorPath). Arm scissors and
  // cut a segment -- a closed path opens in place: same object, closed -> false, d loses Z.
  await page.keyboard.press('c');
  await page.mouse.click(box.x + 160, box.y + 80); // midpoint of the (80,80)-(240,80) segment

  await expect(stageObjects).toHaveCount(1);
  await expect(pathEl).not.toHaveAttribute('d', /Z/);
});
