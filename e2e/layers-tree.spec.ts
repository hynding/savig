import { test, expect } from '@playwright/test';

// Slice 45c: the Layers panel shows the group hierarchy — a group row with its children
// nested + expand/collapse, and the group's eye hides the whole group (cascade).
test('Layers tree: group row nests its children, collapses, and the group eye cascades', async ({ page }) => {
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
  const childIds = await objects.evaluateAll((els) => els.map((e) => e.getAttribute('data-savig-object')!));

  // Group them.
  await objects.nth(0).click();
  await objects.nth(1).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Group', exact: true }).click();

  // The Layers panel now has a group row + the two children nested (depth 1).
  const layers = page.locator('section[aria-label="Layers"], [aria-label="Layers"]').first();
  const layerRows = layers.locator('[data-testid^="layer-"]');
  await expect(layerRows).toHaveCount(3); // group + 2 children
  for (const id of childIds) {
    await expect(layers.locator(`[data-testid="layer-${id}"]`)).toHaveAttribute('data-depth', '1');
  }
  // The group row: the one whose testid is not a child id.
  const groupRow = layers.locator('[data-testid^="layer-"][data-depth="0"]');
  await expect(groupRow).toHaveCount(1);
  const groupId = (await groupRow.getAttribute('data-testid'))!.replace('layer-', '');

  // Collapse -> the child rows disappear; expand -> they come back.
  await layers.locator(`[data-testid="disclosure-${groupId}"]`).click();
  await expect(layerRows).toHaveCount(1);
  await layers.locator(`[data-testid="disclosure-${groupId}"]`).click();
  await expect(layerRows).toHaveCount(3);

  // The group eye cascades: hiding the group removes both children from the Stage.
  await layers.locator(`[data-testid="vis-${groupId}"]`).click();
  await expect(objects).toHaveCount(0);
  await layers.locator(`[data-testid="vis-${groupId}"]`).click();
  await expect(objects).toHaveCount(2);
});
