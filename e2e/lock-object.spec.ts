import { test, expect } from '@playwright/test';

test('locking an object makes it non-interactive on the stage', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect — it is auto-selected, so the resize-handle overlay is visible.
  await page
    .getByRole('group', { name: 'Tools' })
    .getByRole('button', { name: 'Rectangle', exact: true })
    .click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 180);
  await page.mouse.up();
  await expect(page.getByTestId('resize-handles')).toBeVisible();

  // Lock it via the Layers panel.
  const row = page.locator('section[aria-label="Assets"] [data-testid^="layer-"]').first();
  const rowId = (await row.getAttribute('data-testid'))!.replace('layer-', '');
  await page.getByTestId(`lock-${rowId}`).click();

  // Handles disappear, and clicking the shape on the stage does not bring them back.
  await expect(page.getByTestId('resize-handles')).toHaveCount(0);
  await page.mouse.click(box.x + 150, box.y + 140);
  await expect(page.getByTestId('resize-handles')).toHaveCount(0);
  // The object still renders.
  await expect(page.locator('[data-savig-object]')).toHaveCount(1);
});

test('locking a GROUP cascades: a child becomes non-interactive on the stage', async ({ page }) => {
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

  await drawRect(120, 100, 200, 170); // A
  await drawRect(380, 280, 460, 350); // B
  const objects = page.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2);
  const a = objects.nth(0);
  const groupHandles = page.locator('[data-testid="group-handles"]');
  const EMPTY = { x: box.x + 320, y: box.y + 60 };

  // Group A+B.
  await a.click();
  await objects.nth(1).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Group', exact: true }).click();
  await expect(groupHandles).toBeVisible();

  // Lock the GROUP via its top-level Layers row.
  const groupRow = page.locator('section[aria-label="Assets"] [data-testid^="layer-"]').first();
  const groupId = (await groupRow.getAttribute('data-testid'))!.replace('layer-', '');
  await page.getByTestId(`lock-${groupId}`).click();

  // Deselect, then click a child member -> the locked group does NOT select (cascade): no handles.
  await page.mouse.click(EMPTY.x, EMPTY.y);
  await expect(groupHandles).toHaveCount(0);
  const aBefore = (await a.boundingBox())!;
  const ac = { x: aBefore.x + aBefore.width / 2, y: aBefore.y + aBefore.height / 2 };
  await page.mouse.click(ac.x, ac.y);
  await expect(groupHandles).toHaveCount(0); // child of a locked group is inert

  // And dragging the child does not move it.
  await page.mouse.move(ac.x, ac.y);
  await page.mouse.down();
  await page.mouse.move(ac.x + 60, ac.y + 40);
  await page.mouse.up();
  const aAfter = (await a.boundingBox())!;
  expect(Math.abs(aAfter.x - aBefore.x)).toBeLessThan(2); // unchanged
});
