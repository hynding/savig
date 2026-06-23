import { test, expect } from '@playwright/test';

// Slice 45e: a group can contain a group. Build inner {A,B} then outer {inner, C}; the Layers
// tree nests to depth 2; clicking any member selects the OUTERMOST group; moving the outer
// group moves all three.
test('nested groups: build two levels, select the outermost, move all together', async ({ page }) => {
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

  await drawRect(100, 120, 150, 170); // A
  await drawRect(180, 120, 230, 170); // B
  await drawRect(300, 120, 350, 170); // C

  const objects = page.locator('[data-savig-object]');
  await expect(objects).toHaveCount(3);
  const a = objects.nth(0);
  const b = objects.nth(1);
  const c = objects.nth(2);

  // Inner group {A, B}.
  await a.click();
  await b.click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Group', exact: true }).click();
  // Outer group {inner, C}: the inner group is selected; shift-add C; Group.
  await c.click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Group', exact: true }).click();

  // Layers tree: depths 0 (outer) / 1 (inner group + C) / 2 (A, B).
  const layers = page.locator('[aria-label="Layers"]').first();
  await expect(layers.locator('[data-testid^="layer-"][data-depth="2"]')).toHaveCount(2); // A, B
  await expect(layers.locator('[data-testid^="layer-"][data-depth="1"]')).toHaveCount(2); // inner group, C
  await expect(layers.locator('[data-testid^="layer-"][data-depth="0"]')).toHaveCount(1); // outer

  // Click any member -> the OUTERMOST group selects (its bbox handles show).
  await page.mouse.click(box.x + 500, box.y + 60); // deselect (empty area)
  await a.click();
  await expect(page.getByTestId('group-handles')).toBeVisible();

  // Drag the outer group -> all three move together by the same delta.
  const aB = (await a.boundingBox())!;
  const cB = (await c.boundingBox())!;
  const ac = { x: aB.x + aB.width / 2, y: aB.y + aB.height / 2 };
  await page.mouse.move(ac.x, ac.y);
  await page.mouse.down();
  await page.mouse.move(ac.x + 50, ac.y + 30);
  await page.mouse.up();
  const aA = (await a.boundingBox())!;
  const cA = (await c.boundingBox())!;
  expect(aA.x - aB.x).toBeGreaterThan(5); // A moved
  expect(Math.abs(cA.x - cB.x - (aA.x - aB.x))).toBeLessThan(2); // C moved by the same delta
});
