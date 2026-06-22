import { test, expect } from '@playwright/test';

test('cut a keyframe and paste it at a new time', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect (auto-selected); key rotation at t=0 via the Inspector.
  await page
    .getByRole('group', { name: 'Tools' })
    .getByRole('button', { name: 'Rectangle', exact: true })
    .click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 160);
  await page.mouse.up();
  const rotField = page.getByLabel('rotation', { exact: true });
  await rotField.fill('40');
  await rotField.blur();

  // Select the rotation diamond at t=0, cut it.
  await page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-0"]').first().click();
  await page.keyboard.press('ControlOrMeta+KeyX');
  await expect(page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-0"]')).toHaveCount(0);

  // Move the playhead to t=1 and paste it back.
  await page.getByTestId('timeline-ruler').click({ position: { x: 100, y: 10 } });
  await page.keyboard.press('ControlOrMeta+KeyV');
  await expect(page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-1"]')).toHaveCount(1);
});
