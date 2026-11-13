import { test, expect } from '@playwright/test';

// Timeline zoom: the header controls and Ctrl+wheel widen every timeline surface together.
test('zooming the timeline widens the ruler and keeps the playhead aligned', async ({ page }) => {
  await page.goto('/');
  // A template with a timeline to zoom ("Bouncing ball" lasts 1.8 s at 30 fps).
  await page.getByRole('button', { name: 'New from template' }).click();
  await page.getByRole('dialog', { name: 'Template gallery' }).getByText('Bouncing ball', { exact: true }).click();
  await page.getByRole('button', { name: 'Pause' }).click(); // the template autoplays
  const ruler = page.getByTestId('timeline-ruler');
  const readout = page.getByTestId('timeline-zoom');
  await expect(readout).toHaveText('100%');

  const second = page.getByTestId('ruler-second-1');
  const x100 = (await second.boundingBox())!.x - (await ruler.boundingBox())!.x;

  await page.getByRole('button', { name: 'Zoom timeline in' }).click();
  await page.getByRole('button', { name: 'Zoom timeline in' }).click();
  await expect(readout).toHaveText('200%');
  const x200 = (await second.boundingBox())!.x - (await ruler.boundingBox())!.x;
  expect(x200).toBeCloseTo(x100 * 2, 0);

  // Scrubbing at 200%: a click 0.5 s into the ruler puts the playhead under the pointer.
  const box = (await ruler.boundingBox())!;
  await page.mouse.click(box.x + x200 / 2, box.y + box.height / 2);
  const playhead = (await page.getByTestId('playhead').boundingBox())!;
  expect(Math.abs(playhead.x - (box.x + x200 / 2))).toBeLessThan(4);

  // Ctrl+wheel over the timeline zooms it (and not the page); a frame-number row appears once
  // cells are wide enough.
  await page.getByTestId('timeline-scroll').hover();
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -200);
  await page.keyboard.down('Control');
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await expect(readout).not.toHaveText('200%');
  await expect(page.getByTestId('ruler-frame-2')).toBeVisible();

  await page.getByRole('button', { name: 'Reset timeline zoom' }).click();
  await expect(readout).toHaveText('100%');
});
