import { test, expect } from '@playwright/test';

test('dragging a group scale handle grows the whole selection', async ({ page }) => {
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

  // Select both.
  await a.click();
  await b.click({ modifiers: ['Shift'] });

  const aBefore = (await a.boundingBox())!;
  const bBefore = (await b.boundingBox())!;

  // Drag the group SE handle outward (down-right) -> the whole group scales up.
  const se = page.getByTestId('group-handle-se');
  const hb = (await se.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 120, hb.y + hb.height / 2 + 100);
  await page.mouse.up();

  const aAfter = (await a.boundingBox())!;
  const bAfter = (await b.boundingBox())!;
  expect(aAfter.width).toBeGreaterThan(aBefore.width + 5); // A grew
  expect(bAfter.width).toBeGreaterThan(bBefore.width + 5); // B grew
});
