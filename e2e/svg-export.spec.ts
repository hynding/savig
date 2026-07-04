import { test, expect } from '@playwright/test';

test('export animated SVG from the command palette', async ({ page }) => {
  // Force the anchor-download fallback (headless has no File System Access picker).
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto('/');

  // Draw something so the export has content.
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 180);
  await page.mouse.up();

  // Run "Export animated SVG" from the palette and capture the download.
  await page.locator('section[aria-label="Stage"]').click();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByLabel('Command search').fill('export animated svg');
  const downloadPromise = page.waitForEvent('download');
  await palette.getByLabel('Command search').press('Enter');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.svg$/);
});
