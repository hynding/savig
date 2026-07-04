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

test('the card does not block canvas drawing in its footprint (pointer-events: none)', async ({ page }) => {
  await page.goto('/');
  const card = page.getByRole('complementary', { name: 'Getting started' });
  await expect(card).toBeVisible();
  const cardBox = (await card.boundingBox())!;

  // Draw a rectangle whose press-point is INSIDE the card's on-screen footprint. If the card
  // intercepted pointer events, no object would be created.
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  const px = cardBox.x + cardBox.width / 2;
  const py = cardBox.y + cardBox.height / 2;
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px - 60, py - 40);
  await page.mouse.up();

  await expect(page.locator('section[aria-label="Stage"] [data-savig-object]')).toHaveCount(1);
});

test('reopening from the palette does not un-dismiss (reload stays hidden)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  await expect(page.getByRole('complementary', { name: 'Getting started' })).toBeHidden();

  // Reopen via the command palette (per-session; must NOT clear the dismissed flag).
  await page.locator('section[aria-label="Stage"]').click();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByLabel('Command search').fill('getting started');
  await palette.getByLabel('Command search').press('Enter');
  await expect(page.getByRole('complementary', { name: 'Getting started' })).toBeVisible();

  // Reload → the dismissed flag persists → stays hidden.
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Getting started' })).toBeHidden();
});
