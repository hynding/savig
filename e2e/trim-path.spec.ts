import { test, expect } from '@playwright/test';

test('trim end animates the stroke window (draw-on) and scrubs correctly', async ({ page }) => {
  await page.goto('/');
  // Draw a rect.
  await page.getByRole('button', { name: 'Rectangle' }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 160);
  await page.mouse.up();
  const shape = page.locator('section[aria-label="Stage"] [data-savig-object] > *').first();

  // Keyframe trim end: 0 at t=0, 1 at a later playhead (autoKey defaults on).
  await page.getByTestId('timeline-ruler').click({ position: { x: 0, y: 10 } });
  await page.getByLabel('trim end', { exact: true }).fill('0');
  await page.getByLabel('trim end', { exact: true }).press('Enter');
  await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } });
  await page.getByLabel('trim end', { exact: true }).fill('1');
  await page.getByLabel('trim end', { exact: true }).press('Enter');

  // At t=0 the stroke is fully hidden; scrubbed forward it opens up.
  await page.getByTestId('timeline-ruler').click({ position: { x: 0, y: 10 } });
  await expect(shape).toHaveAttribute('stroke-dasharray', '0 1');
  await expect(shape).toHaveAttribute('pathLength', '1');
  await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } });
  await expect(shape).toHaveAttribute('stroke-dasharray', '1 0');
});

test('trim and dash are mutually exclusive in the Inspector', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rectangle' }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 140);
  await page.mouse.up();

  // autoKey off so the trim edit sets a persistent base value (not just a keyframe track)
  // and the dash checkbox sees a base trim to react to.
  await page.getByRole('button', { name: 'Auto-key' }).click();

  // Dash on -> trim inputs replaced by the hint.
  await page.getByLabel('dashed', { exact: true }).check();
  await expect(page.getByText('Remove dash pattern to use Trim')).toBeVisible();
  await page.getByLabel('dashed', { exact: true }).uncheck();

  // Trim set -> dash checkbox disabled.
  await page.getByLabel('trim end', { exact: true }).fill('0.5');
  await page.getByLabel('trim end', { exact: true }).press('Enter');
  await expect(page.getByLabel('dashed', { exact: true })).toBeDisabled();
});
