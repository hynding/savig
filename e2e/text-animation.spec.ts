import { test, expect } from '@playwright/test';

// Per-character text animation (spec 2026-11-16-text-animator): pick a preset in the Inspector,
// scrub the timeline and watch the letters arrive, tune a field, remove it.
test('animate a title letter by letter from the Inspector', async ({ page }) => {
  await page.goto('/');
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.getByRole('button', { name: 'Text' }).click();
  await page.mouse.click(box.x + 150, box.y + 150);
  const content = page.getByLabel('text content', { exact: true });
  await content.fill('Hello');
  await content.blur();

  await page.getByTestId('text-animation-preset').selectOption({ label: 'Fade up' });
  await expect(page.getByTestId('text-animation-card')).toBeVisible();
  const units = page.locator('section[aria-label="Stage"] tspan[data-savig-unit]');
  await expect(units).toHaveCount(5);

  // Scrub: early on the last letter is still hidden, at the end every letter is fully shown.
  await page.getByTestId('timeline-ruler').click({ position: { x: 2, y: 10 } });
  await expect(units.nth(4)).toHaveAttribute('fill-opacity', '0');
  await page.getByTestId('timeline-ruler').click({ position: { x: 400, y: 10 } });
  await expect(units.nth(4)).toHaveAttribute('fill-opacity', '1');
  await expect(units.nth(0)).toHaveAttribute('dy', '0');

  // Word mode: one tspan for the single word.
  await page.getByLabel('text animation by').selectOption('word');
  await expect(units).toHaveCount(1);

  await page.getByLabel('remove text animation').click();
  await expect(units).toHaveCount(0);
  await expect(page.getByTestId('text-animation-card')).toHaveCount(0);
});
