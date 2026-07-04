import { test, expect } from '@playwright/test';

test('getting-started checklist shows, checks off, dismisses, and stays dismissed', async ({ page }) => {
  await page.goto('/');

  const card = page.getByRole('complementary', { name: 'Getting started' });
  await expect(card).toBeVisible();
  // "Draw a shape" starts undone.
  await expect(card.locator('li', { hasText: 'Draw a shape' })).toHaveAttribute('data-done', 'false');

  // Draw a rectangle → the item checks off live.
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 120, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 200);
  await page.mouse.up();
  await expect(card.locator('li', { hasText: 'Draw a shape' })).toHaveAttribute('data-done', 'true');

  // Dismiss → hidden, and it stays hidden after a reload (persisted).
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  await expect(card).toBeHidden();
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Getting started' })).toBeHidden();
});
