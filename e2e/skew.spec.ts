import { test, expect } from '@playwright/test';

// Skew (spec 2026-11-18-skew-distort): the Inspector's skewX / skewY fields shear the shape on the
// Stage through its transform, and the selection box follows the sheared outline.
test('typing a skew in the Inspector shears the shape on the Stage', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 140);
  await page.mouse.up();

  const shape = page.locator('section[aria-label="Stage"] [data-savig-object]').first();
  const before = (await shape.boundingBox())!;
  await expect(shape).not.toHaveAttribute('transform', /skew/);

  const field = page.getByLabel('skewX', { exact: true });
  await field.fill('30');
  await field.press('Enter');
  await expect(shape).toHaveAttribute('transform', /skewX\(30\)/);
  const after = (await shape.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width + 20); // a 30° shear widens the drawn box

  const fieldY = page.getByLabel('skewY', { exact: true });
  await fieldY.fill('-10');
  await fieldY.press('Enter');
  await expect(shape).toHaveAttribute('transform', /skewX\(30\) skewY\(-10\)/);
});

test('dragging the top skew handle shears the shape with its bottom edge fixed; one undo restores it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 160);
  await page.mouse.up();

  const shape = page.locator('section[aria-label="Stage"] [data-savig-object]').first();
  const before = (await shape.boundingBox())!;
  const handle = page.getByTestId('skew-handle-n');
  await expect(handle).toBeVisible();
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 25, h.y + h.height / 2, { steps: 4 });
  await page.mouse.move(h.x + h.width / 2 + 50, h.y + h.height / 2, { steps: 4 });
  await expect(page.getByTestId('rotate-readout')).toContainText('skew X');
  await page.mouse.up();

  await expect(shape).toHaveAttribute('transform', /skewX\(-/);
  const after = (await shape.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width + 30);
  expect(Math.abs(after.y + after.height - (before.y + before.height))).toBeLessThan(2); // bottom edge stays
  expect(Number(await page.getByLabel('skewX', { exact: true }).inputValue())).toBeLessThan(-10);

  await page.keyboard.press('ControlOrMeta+z');
  await expect(shape).not.toHaveAttribute('transform', /skew/);
});
