import { test, expect } from '@playwright/test';

test('a motion preset animates the selected shape in one click', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 200, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 280, box.y + 160);
  await page.mouse.up();
  const x = page.getByLabel('x', { exact: true });
  const x0 = Number(await x.inputValue());

  await page.getByTestId('presets-toggle').click();
  await expect(page.getByTestId('presets-panel')).toBeVisible();
  await page.getByTestId('preset-slide-in-left').click();
  await expect(page.getByTestId('presets-panel')).toBeVisible(); // stays open for another pick
  await page.keyboard.press('Escape');

  // At t=0 the shape starts 200px to the left; by 0.6 s it is home.
  await page.getByTestId('timeline-ruler').click({ position: { x: 0, y: 10 } });
  await expect.poll(async () => Number(await x.inputValue())).toBeCloseTo(x0 - 200, 0);
  await page.getByTestId('timeline-ruler').click({ position: { x: 60, y: 10 } });
  await expect.poll(async () => Number(await x.inputValue())).toBeCloseTo(x0, 0);
  // The new keys show on the Timeline.
  await expect(page.locator('[data-testid^="keyframe-"][data-testid*="-x-"]')).toHaveCount(2);
  if (process.env.PRESET_SHOT) {
    await page.getByTestId('presets-toggle').click();
    await page.screenshot({ path: process.env.PRESET_SHOT });
  }
});
