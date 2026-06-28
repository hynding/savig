import { test, expect } from '@playwright/test';

test('an SVG-asset object is a boolean operand: union contributes its silhouette', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const stage = page.locator('section[aria-label="Stage"]');
  const svgEl = stage.locator('svg').first();
  const box = (await svgEl.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });

  // Import box.svg (a 50x50 filled square) and instance it (auto-selected), then move it to the
  // left via the x/y fields so it sits in a clear area, disjoint from the rect we draw on the right.
  await page.getByLabel('Import SVG').setInputFiles('e2e/fixtures/box.svg');
  await page.getByRole('button', { name: 'box.svg', exact: true }).click();
  await page.getByRole('button', { name: 'Select' }).click();
  const xField = page.getByLabel('x', { exact: true });
  await xField.fill('40');
  await xField.blur();
  const yField = page.getByLabel('y', { exact: true });
  await yField.fill('200');
  await yField.blur();

  // Draw a rect on the RIGHT, disjoint from the SVG square.
  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 320, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 260);
  await page.mouse.up();

  const objects = stage.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2); // the SVG <use> + the drawn rect

  // Identify the two by tag: the SVG instances as <use>, the rect as a <g>.
  const svgObj = stage.locator('use[data-savig-object]').first();
  const rectObj = stage.locator('g[data-savig-object]').first();

  // Select both (click the SVG, shift-click the rect) via element clicks (reliable targeting).
  await svgObj.click();
  await rectObj.click({ modifiers: ['Shift'] });
  await expect(page.getByText(/2 objects selected/i)).toBeVisible();

  // Union -> destructive collapse to one result object.
  await page.getByRole('button', { name: 'Union', exact: true }).click();
  await expect(objects).toHaveCount(1);

  // The result is a compound path with TWO disjoint subpaths: the rect AND the SVG square. If the SVG
  // had contributed no geometry, the union would be just the rect (one M subpath).
  const d = (await stage.locator('[data-savig-object] path').first().getAttribute('d'))!;
  expect((d.match(/M/g) || []).length).toBeGreaterThanOrEqual(2);
});
