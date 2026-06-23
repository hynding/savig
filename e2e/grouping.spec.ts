import { test, expect } from '@playwright/test';

test('group two objects: clicking one selects the group and drags both; ungroup splits them', async ({
  page,
}) => {
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
  const outlines = page.locator('[data-testid^="selection-outline-"]');
  const EMPTY = { x: box.x + 320, y: box.y + 60 }; // between/above the two rects — always empty

  // Select both, then Group via the Inspector.
  await a.click();
  await b.click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Group', exact: true }).click();

  // Deselect, then click ONE member -> the whole group selects (2 outlines).
  await page.mouse.click(EMPTY.x, EMPTY.y);
  await expect(outlines).toHaveCount(0);
  await a.click();
  await expect(outlines).toHaveCount(2);

  // Drag A (a group member) -> the whole group translates together.
  const aBefore = (await a.boundingBox())!;
  const bBefore = (await b.boundingBox())!;
  const ac = { x: aBefore.x + aBefore.width / 2, y: aBefore.y + aBefore.height / 2 };
  await page.mouse.move(ac.x, ac.y);
  await page.mouse.down();
  await page.mouse.move(ac.x + 60, ac.y + 40);
  await page.mouse.up();
  const aAfter = (await a.boundingBox())!;
  const bAfter = (await b.boundingBox())!;
  expect(aAfter.x - aBefore.x).toBeGreaterThan(10); // A moved right
  // B moved by the same delta (the group translated as a unit).
  expect(Math.abs(bAfter.x - bBefore.x - (aAfter.x - aBefore.x))).toBeLessThan(2);
  expect(Math.abs(bAfter.y - bBefore.y - (aAfter.y - aBefore.y))).toBeLessThan(2);

  // Ungroup -> clicking one member now selects ONLY that member (1 outline).
  await page.getByRole('button', { name: 'Ungroup', exact: true }).click();
  await page.mouse.click(EMPTY.x, EMPTY.y);
  await expect(outlines).toHaveCount(0);
  await a.click();
  await expect(outlines).toHaveCount(1);
});
