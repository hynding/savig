import { test, expect } from '@playwright/test';

test('dragging a MULTI-selection between two neighbors snaps the combined bbox to equal gaps + guides', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const drawRect = async (x0: number, y0: number, x1: number, y1: number) => {
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.up();
  };

  // L / R neighbors in the left third; a PAIR (M1,M2) to drag as a unit, off-centre.
  await drawRect(80, 200, 120, 260); // L
  await drawRect(320, 200, 360, 260); // R
  await drawRect(240, 200, 260, 260); // M1
  await drawRect(270, 200, 290, 260); // M2

  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const objects = page.locator('section[aria-label="Stage"] [data-savig-object]');
  await expect(objects).toHaveCount(4);
  const l = objects.nth(0);
  const r = objects.nth(1);
  const m1 = objects.nth(2);
  const m2 = objects.nth(3);
  const lBox = (await l.boundingBox())!;
  const rBox = (await r.boundingBox())!;

  // Select the pair.
  await m1.click();
  await m2.click({ modifiers: ['Shift'] });
  await expect(page.getByText(/2 objects selected/i)).toBeVisible();

  // Combined-bbox centre target = midway between L.right and R.left.
  const combinedCx = ((await m1.boundingBox())!.x + (await m2.boundingBox())!.x + (await m2.boundingBox())!.width) / 2;
  const centredCx = (lBox.x + lBox.width + rBox.x) / 2;
  const grabX = (await m1.boundingBox())!.x + (await m1.boundingBox())!.width / 2;
  const grabY = (await m1.boundingBox())!.y + (await m1.boundingBox())!.height / 2;

  // Drag the pair (grab M1) left; probe the object-px-per-mouse-px ratio, then aim onto the centre.
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(grabX - 60, grabY);
  const probeCx = ((await m1.boundingBox())!.x + (await m2.boundingBox())!.x + (await m2.boundingBox())!.width) / 2;
  const ratio = (combinedCx - probeCx) / 60;
  expect(ratio).toBeGreaterThan(0.1);
  await page.mouse.move(grabX - 60 - (probeCx - centredCx) / ratio, grabY);
  await expect(page.getByTestId('spacing-guide').first()).toBeAttached(); // spacing now fires for multi-select
  await page.mouse.up();
  await expect(page.getByTestId('spacing-guide')).toHaveCount(0);

  // The combined bbox is centred: equal gaps from L and R.
  const m1After = (await m1.boundingBox())!;
  const m2After = (await m2.boundingBox())!;
  const gapLeft = m1After.x - (lBox.x + lBox.width);
  const gapRight = rBox.x - (m2After.x + m2After.width);
  expect(Math.abs(gapLeft - gapRight)).toBeLessThan(3);
});
