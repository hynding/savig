import { test, expect } from '@playwright/test';

test('a locked object keyframe cannot be dragged to retime in the timeline', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect (auto-selected); key rotation at t=0 via the Inspector.
  await page
    .getByRole('group', { name: 'Tools' })
    .getByRole('button', { name: 'Rectangle', exact: true })
    .click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 160);
  await page.mouse.up();
  const rotField = page.getByLabel('rotation', { exact: true });
  await rotField.fill('40');
  await rotField.blur();

  // Lock the object via the Layers panel.
  const row = page.locator('section[aria-label="Assets"] [data-testid^="layer-"]').first();
  const rowId = (await row.getAttribute('data-testid'))!.replace('layer-', '');
  await page.getByTestId(`lock-${rowId}`).click();

  // Attempt to drag its rotation diamond at t=0 right by 100px — it must NOT move.
  const diamond = page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-0"]').first();
  const db = (await diamond.boundingBox())!;
  await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2);
  await page.mouse.down();
  await page.mouse.move(db.x + db.width / 2 + 100, db.y + db.height / 2);
  await page.mouse.up();

  await expect(page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-0"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-1"]')).toHaveCount(0);
});

test('lock cascade: a keyframe of a child of a LOCKED GROUP cannot be retimed', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const tools = page.getByRole('group', { name: 'Tools' });
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const drawRect = async (x0: number, y0: number, x1: number, y1: number) => {
    await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.up();
  };

  // Draw A (auto-selected) and key rotation at t=0.
  await drawRect(100, 100, 180, 160);
  const rotField = page.getByLabel('rotation', { exact: true });
  await rotField.fill('40');
  await rotField.blur();
  // Draw B, then group A+B.
  await drawRect(360, 260, 440, 320);
  const objects = page.locator('[data-savig-object]');
  await objects.nth(0).click();
  await objects.nth(1).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Group', exact: true }).click();

  // Lock the GROUP (its top-level Layers row).
  const groupRow = page.locator('section[aria-label="Assets"] [data-testid^="layer-"]').first();
  const groupId = (await groupRow.getAttribute('data-testid'))!.replace('layer-', '');
  await page.getByTestId(`lock-${groupId}`).click();

  // Dragging A's rotation diamond must NOT retime (cascade from the locked group).
  const diamond = page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-0"]').first();
  const db = (await diamond.boundingBox())!;
  await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2);
  await page.mouse.down();
  await page.mouse.move(db.x + db.width / 2 + 100, db.y + db.height / 2);
  await page.mouse.up();

  await expect(page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-0"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-1"]')).toHaveCount(0);
});
