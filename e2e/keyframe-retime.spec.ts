import { test, expect } from '@playwright/test';

test('drag a keyframe diamond to retime it', async ({ page }) => {
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

  // Drag the rotation diamond at t=0 right by 100px (PX_PER_SECOND) -> t=1.
  const diamond = page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-0"]').first();
  const db = (await diamond.boundingBox())!;
  await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2);
  await page.mouse.down();
  await page.mouse.move(db.x + db.width / 2 + 100, db.y + db.height / 2);
  await page.mouse.up();

  await expect(page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-1"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-0"]')).toHaveCount(0);
});
