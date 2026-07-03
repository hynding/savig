import { test, expect } from '@playwright/test';

test('resize the stage via the Inspector document panel', async ({ page }) => {
  await page.goto('/');

  // Fresh project, nothing selected -> the Inspector shows the Document size panel.
  const inspector = page.locator('section[aria-label="Inspector"]');
  await expect(inspector.getByText('Document')).toBeVisible();

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  await expect(svg).toHaveAttribute('viewBox', '0 0 1280 720');

  // Type a new width.
  const width = inspector.getByLabel('Stage width');
  await width.fill('800');
  await width.press('Enter');
  await expect(svg).toHaveAttribute('viewBox', '0 0 800 720');

  // A preset resizes both dimensions.
  await inspector.getByLabel('Stage size preset').selectOption({ label: '1080p (1920×1080)' });
  await expect(svg).toHaveAttribute('viewBox', '0 0 1920 1080');

  // Undo restores the previous size.
  await page.keyboard.press('Control+z');
  await expect(svg).toHaveAttribute('viewBox', '0 0 800 720');
});
