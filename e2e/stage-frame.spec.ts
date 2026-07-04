import { test, expect } from '@playwright/test';

test('stage frame: renders by default, toggles off, and never blocks out-of-bounds objects', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const stage = page.locator('section[aria-label="Stage"]');

  // The frame + out-of-bounds scrim are visible by default (frameEnabled defaults on).
  await expect(stage.getByTestId('stage-frame')).toBeVisible();
  await expect(stage.getByTestId('stage-scrim')).toBeVisible();

  // The scrim must never intercept pointer events — draw a rect straight through it.
  const svg = stage.locator('svg').first();
  const box = (await svg.boundingBox())!;
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 120, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 190);
  await page.mouse.up();
  await expect(stage.locator('[data-savig-object]').first()).toBeVisible();

  // Toggling Frame off removes both the outline and the scrim.
  await page.getByRole('button', { name: 'Frame', exact: true }).click();
  await expect(stage.getByTestId('stage-frame')).toHaveCount(0);
  await expect(stage.getByTestId('stage-scrim')).toHaveCount(0);

  // Toggling back on restores them.
  await page.getByRole('button', { name: 'Frame', exact: true }).click();
  await expect(stage.getByTestId('stage-frame')).toBeVisible();
});
