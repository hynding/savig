import { test, expect } from '@playwright/test';

test('double-click a layer name to rename the object', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect.
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

  // The Layers panel lists it; rename via double-click.
  const row = page.locator('section[aria-label="Assets"] [data-testid^="layer-"]').first();
  await expect(row).toBeVisible();
  const rowId = (await row.getAttribute('data-testid'))!.replace('layer-', '');
  await row.locator('span').first().dblclick();
  const input = page.getByTestId(`rename-${rowId}`);
  await input.fill('Hero');
  await input.press('Enter');

  await expect(row).toContainText('Hero');
});
