import { test, expect } from '@playwright/test';

// Slice 45b: a group CONTAINER has its own transform — scaling its bbox handles scales the
// whole group as a unit (children compose the group transform), and ungroup bakes the
// transform into the children so they keep their world size.
test('scaling a group container grows its children; ungroup keeps their size', async ({ page }) => {
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

  await drawRect(120, 120, 180, 180); // A
  await drawRect(300, 120, 360, 180); // B

  const objects = page.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2);
  const a = objects.nth(0);
  const b = objects.nth(1);

  // Select both and Group into a container.
  await a.click();
  await b.click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Group', exact: true }).click();
  await expect(page.getByTestId('group-handles')).toBeVisible();

  const aBefore = (await a.boundingBox())!;
  const bBefore = (await b.boundingBox())!;

  // Drag the group SE handle outward -> the GROUP scales; both children grow.
  const se = page.getByTestId('group-handle-se');
  const hb = (await se.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 140, hb.y + hb.height / 2 + 120);
  await page.mouse.up();

  const aGrown = (await a.boundingBox())!;
  const bGrown = (await b.boundingBox())!;
  expect(aGrown.width).toBeGreaterThan(aBefore.width + 5); // A grew with the group
  expect(bGrown.width).toBeGreaterThan(bBefore.width + 5); // B grew with the group

  // Ungroup -> the children keep their (now larger) world size, independently selectable.
  await page.getByRole('button', { name: 'Ungroup', exact: true }).click();
  const aUngrouped = (await a.boundingBox())!;
  expect(Math.abs(aUngrouped.width - aGrown.width)).toBeLessThan(2); // size preserved by the bake
  // Deselect, then clicking one selects ONLY that object (a single-object outline, no group).
  await page.mouse.click(box.x + 250, box.y + 350); // empty area below the rects
  await a.click();
  await expect(page.locator('[data-testid^="selection-outline-"]')).toHaveCount(1);
});
