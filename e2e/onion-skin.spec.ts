import { test, expect } from '@playwright/test';

test('toggling onion skin shows ghosts for an animated object', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect, then switch to the select tool.
  await page.getByRole('button', { name: 'Rectangle' }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 180);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Select' }).click();

  // Keyframe x at two times via the ruler + the Inspector x field (autoKey defaults on).
  await page.getByTestId('timeline-ruler').click({ position: { x: 0, y: 10 } });
  const xField = page.getByLabel('x', { exact: true });
  await xField.fill('40');
  await xField.blur();
  await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } });
  await xField.fill('200');
  await xField.blur();

  // Seek between the keyframes and toggle onion on.
  await page.getByTestId('timeline-ruler').click({ position: { x: 60, y: 10 } });
  await page.getByRole('button', { name: /onion/i }).click();

  await expect(page.getByTestId('onion-skins')).toBeAttached();
  await expect(page.locator('[data-testid^="onion-ghost-"]').first()).toBeAttached();
});
