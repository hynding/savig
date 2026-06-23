import { test, expect } from '@playwright/test';

test('create a symbol from two shapes: the instance renders its internals as composite-id leaves', async ({
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

  // Select both, then Create Symbol via the Inspector.
  await a.click();
  await b.click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();

  // The two top-level rects are now ONE instance expanded into two composite-id leaves
  // ("instId/rectId"). The flat scene still shows two drawn nodes, both namespaced.
  await expect(objects).toHaveCount(2);
  const composite = page.locator('[data-savig-object*="/"]');
  await expect(composite).toHaveCount(2);

  // Clicking an internal leaf selects the owning instance atomically: the Inspector shows the
  // single-object panel for the instance (no multi-select "objects selected" row).
  await composite.first().click();
  await expect(page.getByText(/objects selected/)).toHaveCount(0);
});
