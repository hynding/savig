import { test, expect } from '@playwright/test';

test('a wiggle moves a shape with no keys, and shows on the timeline', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 200, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 280, box.y + 160);
  await page.mouse.up();
  const x = page.getByLabel('x', { exact: true });

  await page.getByTestId('inspector-add-modifier').selectOption('wiggle:x');
  await expect(page.getByTestId('modifier-card-x')).toBeVisible();
  const amount = page.getByLabel('X wiggle amount');
  await amount.fill('40');
  await amount.press('Enter');
  await expect(page.locator('[data-testid^="modifier-badge-"]')).toHaveCount(1);
  // No keys anywhere: the shape still moves over time.
  const samples: number[] = [];
  for (const px of [10, 45, 80, 115, 150]) {
    await page.getByTestId('timeline-ruler').click({ position: { x: px, y: 10 } });
    await page.waitForTimeout(50);
    samples.push(Number(await x.inputValue()));
  }
  expect(new Set(samples.map((v) => Math.round(v))).size).toBeGreaterThan(2);
  expect(Math.max(...samples) - Math.min(...samples)).toBeLessThanOrEqual(80.5);
  await expect(page.locator('[data-testid^="keyframe-"]')).toHaveCount(0);
  if (process.env.MOD_SHOT) await page.screenshot({ path: process.env.MOD_SHOT });

  await page.getByLabel('remove X modifiers').click();
  await expect(page.locator('[data-testid^="modifier-badge-"]')).toHaveCount(0);
});

test('a blur wiggle comes from the Inspector and leaves with its filter (modifiers everywhere)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 200, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 280, box.y + 160);
  await page.mouse.up();
  const id = (await page.locator('[data-savig-object]').first().getAttribute('data-savig-object'))!;

  await page.getByTestId('inspector-add-filter').selectOption('blur');
  await page.getByTestId('inspector-add-modifier').selectOption({ label: 'Wiggle Blur' });
  await expect(page.locator('[data-testid^="modifier-card-filter:"]')).toBeVisible();
  const blur = page.locator(`filter[id="savig-filter-${id}"] feGaussianBlur`);
  const values = new Set<string | null>();
  for (const px of [10, 45, 80, 115, 150]) {
    await page.getByTestId('timeline-ruler').click({ position: { x: px, y: 10 } });
    await page.waitForTimeout(50);
    values.add(await blur.getAttribute('stdDeviation'));
  }
  expect(values.size).toBeGreaterThan(2);
  await expect(page.locator('[data-testid^="modifier-badge-"]')).toHaveAttribute('aria-label', /Blur wiggle/);

  // Removing the filter takes its modifier with it.
  await page.getByLabel('remove Blur', { exact: true }).click();
  await expect(page.locator('[data-testid^="modifier-card-filter:"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="modifier-badge-"]')).toHaveCount(0);
});
