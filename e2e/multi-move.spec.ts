import { test, expect } from '@playwright/test';

test('dragging one of two selected objects moves both by the same delta', async ({ page }) => {
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
  const b = objects.nth(1);

  // Select both: click A, Shift-click B.
  await a.click();
  await b.click({ modifiers: ['Shift'] });

  const aBefore = (await a.boundingBox())!;
  const bBefore = (await b.boundingBox())!;

  // Drag B (a selected member) -> the whole selection moves.
  const bc = { x: bBefore.x + bBefore.width / 2, y: bBefore.y + bBefore.height / 2 };
  await page.mouse.move(bc.x, bc.y);
  await page.mouse.down();
  await page.mouse.move(bc.x + 60, bc.y + 40);
  await page.mouse.up();

  const aAfter = (await a.boundingBox())!;
  const bAfter = (await b.boundingBox())!;

  expect(bAfter.x - bBefore.x).toBeGreaterThan(10); // B actually moved right
  // A moved by the same delta as B (the whole selection translated together).
  expect(Math.abs(aAfter.x - aBefore.x - (bAfter.x - bBefore.x))).toBeLessThan(2);
  expect(Math.abs(aAfter.y - aBefore.y - (bAfter.y - bBefore.y))).toBeLessThan(2);
});
