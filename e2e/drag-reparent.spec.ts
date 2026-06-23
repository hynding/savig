import { test, expect } from '@playwright/test';

// Slice 45f: drag a Layers row onto a group row to add the object to that group, preserving
// its on-screen position — then it moves with the group.
test('drag-reparent: drop a Layers row into a group; it then moves with the group', async ({ page }) => {
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
  await drawRect(320, 120, 370, 170); // C

  const objects = page.locator('[data-savig-object]');
  await expect(objects).toHaveCount(3);
  const ids = await objects.evaluateAll((els) => els.map((e) => e.getAttribute('data-savig-object')!));
  const [a, , c] = ids;

  // Group A, B.
  await objects.nth(0).click();
  await objects.nth(1).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Group', exact: true }).click();

  const layers = page.locator('[aria-label="Layers"]').first();
  // The group row = the only top-level (depth 0) Layers row not among the 3 drawn objects.
  const gid = await layers
    .locator('[data-testid^="layer-"][data-depth="0"]')
    .evaluateAll(
      (els, drawn) =>
        els
          .find((e) => !drawn.includes(e.getAttribute('data-testid')!.replace('layer-', '')))!
          .getAttribute('data-testid')!
          .replace('layer-', ''),
      ids,
    );

  // Drag C's row onto the group row -> C reparents INTO the group (now depth 1).
  await layers.locator(`[data-testid="layer-${c}"]`).dragTo(layers.locator(`[data-testid="layer-${gid}"]`));
  await expect(layers.locator(`[data-testid="layer-${c}"]`)).toHaveAttribute('data-depth', '1');

  // C now moves with the group: select the group (click a member) and drag it.
  const cBefore = (await page.locator(`[data-savig-object="${c}"]`).boundingBox())!;
  await page.locator(`[data-savig-object="${a}"]`).click();
  const ab = (await page.locator(`[data-savig-object="${a}"]`).boundingBox())!;
  const ac = { x: ab.x + ab.width / 2, y: ab.y + ab.height / 2 };
  await page.mouse.move(ac.x, ac.y);
  await page.mouse.down();
  await page.mouse.move(ac.x + 60, ac.y);
  await page.mouse.up();
  const cAfter = (await page.locator(`[data-savig-object="${c}"]`).boundingBox())!;
  expect(cAfter.x - cBefore.x).toBeGreaterThan(5); // C moved with the group it was reparented into
});
