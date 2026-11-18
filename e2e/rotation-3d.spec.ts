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
