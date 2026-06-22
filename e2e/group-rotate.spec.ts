import { test, expect } from '@playwright/test';

test('dragging the group rotate handle rotates the whole selection', async ({ page }) => {
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

  await drawRect(140, 160, 200, 220); // A
  await drawRect(320, 160, 380, 220); // B

  const objects = page.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2);
  const a = objects.nth(0);
  const b = objects.nth(1);

  await a.click();
  await b.click({ modifiers: ['Shift'] });

  const aBefore = await a.getAttribute('transform');
  const bBefore = await b.getAttribute('transform');

  // Drag the rotate handle (above the group bbox) sideways to sweep an angle.
  const h = page.getByTestId('group-rotate-handle');
  const hb = (await h.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 140, hb.y + hb.height / 2 + 120);
  await page.mouse.up();

  // Both objects gained a NON-ZERO rotation (the whole group rotated, not just a
  // translation). buildTransform always emits `rotate(angle, ...)`, so the discriminating
  // check is that it is no longer `rotate(0, ...)`.
  expect(await a.getAttribute('transform')).not.toBe(aBefore);
  expect(await b.getAttribute('transform')).not.toBe(bBefore);
  expect(await a.getAttribute('transform')).not.toContain('rotate(0,');
  expect(await b.getAttribute('transform')).not.toContain('rotate(0,');
});
