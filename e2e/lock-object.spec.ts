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
