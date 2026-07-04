import { test, expect } from '@playwright/test';

test('load a project from the template gallery', async ({ page }) => {
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  // Fresh project default is 1280x720.
  await expect(svg).toHaveAttribute('viewBox', '0 0 1280 720');

  // Open the gallery and load "Bouncing ball" (640x360).
  await page.getByRole('button', { name: 'New from template' }).click();
  const gallery = page.getByRole('dialog', { name: 'Template gallery' });
  await expect(gallery).toBeVisible();
  await gallery.getByText('Bouncing ball').click();

  // The gallery closes, the artboard resized to the template's dimensions, and objects rendered.
  await expect(gallery).toBeHidden();
  await expect(svg).toHaveAttribute('viewBox', '0 0 640 360');
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object]').first()).toBeVisible();
});
