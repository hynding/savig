import { test, expect } from '@playwright/test';

test('copy a keyframe and paste it at a new time', async ({ page }) => {
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

  const rot = page.getByLabel('rotation', { exact: true });
  await rot.fill('40');
  await rot.blur();

  // Select the rotation keyframe diamond at t=0, copy it.
  const firstDiamond = page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-0"]').first();
  await firstDiamond.click();
  await page.keyboard.press('ControlOrMeta+KeyC');

  // Move the playhead to t=1 (PX_PER_SECOND=100) and paste.
  await page.getByTestId('timeline-ruler').click({ position: { x: 100, y: 10 } });
  await page.keyboard.press('ControlOrMeta+KeyV');

  // A second rotation keyframe now exists at t=1.
  await expect(page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-1"]')).toHaveCount(1);
});
