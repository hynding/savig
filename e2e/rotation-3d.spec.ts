import { test, expect } from '@playwright/test';

// 3D rotation (spec 2026-11-18-3d-rotation): the Inspector's rotationX / rotationY fields turn the
// shape in depth. A 60° Y turn draws it half as wide (orthographic); 180° mirrors it.
test('typing a 3D rotation in the Inspector turns the shape on the Stage', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 140);
  await page.mouse.up();

  const shape = page.locator('section[aria-label="Stage"] [data-savig-object]').first();
  const before = (await shape.boundingBox())!;
  await expect(shape).not.toHaveAttribute('transform', /matrix/);

  const fieldY = page.getByLabel('rotationY', { exact: true });
  await fieldY.fill('60');
  await fieldY.press('Enter');
  await expect(shape).toHaveAttribute('transform', /matrix\(0\.5, 0, 0, 1, 0, 0\)/);
  const turned = (await shape.boundingBox())!;
  expect(turned.width).toBeCloseTo(before.width / 2, 0);
  expect(turned.height).toBeCloseTo(before.height, 0);

  // Back flat on Y, then tip 60° about X: half as tall.
  await fieldY.fill('0');
  await fieldY.press('Enter');
  const fieldX = page.getByLabel('rotationX', { exact: true });
  await fieldX.fill('60');
  await fieldX.press('Enter');
  const tipped = (await shape.boundingBox())!;
  expect(tipped.height).toBeCloseTo(before.height / 2, 0);
  expect(tipped.width).toBeCloseTo(before.width, 0);

  for (let i = 0; i < 3; i++) await page.keyboard.press('ControlOrMeta+z');
  await expect(shape).not.toHaveAttribute('transform', /matrix/);
});

test('dragging across a shape with the 3D Rotation tool turns it; one undo restores it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 140);
  await page.mouse.up();
  const shape = page.locator('section[aria-label="Stage"] [data-savig-object]').first();
  const before = (await shape.boundingBox())!;

  await page.keyboard.press('u');
  await expect(page.getByRole('button', { name: '3D Rotation', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('rotate3d-overlay')).toBeVisible();

  // 120 screen px to the right = a 60° turn about Y: half as wide.
  const cx = before.x + before.width / 2;
  const cy = before.y + before.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy, { steps: 3 });
  await page.mouse.move(cx + 120, cy, { steps: 3 });
  await expect(page.getByTestId('rotate-readout')).toContainText('Y 60°');
  await page.mouse.up();

  await expect(shape).toHaveAttribute('transform', /matrix\(0\.5, 0, 0, 1, 0, 0\)/);
  const after = (await shape.boundingBox())!;
  expect(after.width).toBeCloseTo(before.width / 2, 0);
  await expect(page.getByLabel('rotationY', { exact: true })).toHaveValue('60');

  await page.keyboard.press('ControlOrMeta+z');
  await expect(shape).not.toHaveAttribute('transform', /matrix/);
});

// Slice 3: "Bake perspective" writes the turn into the drawing as true perspective (the nearer
// edge taller than the farther one) and clears 3D Rotation; one undo restores it.
test('Bake perspective turns a 3D-rotated rectangle into a foreshortened path', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 140);
  await page.mouse.up();

  await expect(page.getByTestId('bake-perspective')).toHaveCount(0);
  const fieldY = page.getByLabel('rotationY', { exact: true });
  await fieldY.fill('50');
  await fieldY.press('Enter');
  await page.getByTestId('bake-perspective').click();

  const shape = page.locator('section[aria-label="Stage"] [data-savig-object]').first();
  await expect(shape).not.toHaveAttribute('transform', /matrix/);
  await expect(fieldY).toHaveValue('0');
  const d = (await shape.locator('path').first().getAttribute('d')) ?? (await shape.getAttribute('d')) ?? '';
  const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  expect(nums.length).toBeGreaterThanOrEqual(8);
  // Four corners: x0 y0 x1 y1 x2 y2 x3 y3 (TL, TR, BR, BL). Left edge (near the pivot side) vs right edge.
  const [, y0, , y1, , y2, , y3] = nums;
  expect(Math.abs((y3 - y0) - (y2 - y1))).toBeGreaterThan(2);

  await page.keyboard.press('ControlOrMeta+z');
  await expect(shape).toHaveAttribute('transform', /matrix/);
});
