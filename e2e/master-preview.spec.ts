import { test, expect } from '@playwright/test';

/**
 * In-editor master-timeline preview/scrub (the M5-era deferral, shipped with the SceneStrip
 * master bar): scrubbing the bar maps master time onto (scene, local playhead) — auto-selecting
 * the scene — and with the Master toggle ON, Play runs the whole movie across scene boundaries.
 *
 * Object-count assertions are Stage-scoped (SceneStrip thumbnails also emit
 * [data-savig-object] — see the M4 lesson).
 */
test('master preview: scrubbing the bar and playing cross scene boundaries', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const stage = page.locator('section[aria-label="Stage"]');
  const tiles = page.getByRole('list', { name: 'Scenes' }).getByRole('listitem');

  // Two scenes; a rect lives ONLY in scene 2, making "which scene is active" Stage-observable.
  await page.getByRole('button', { name: 'Add scene' }).click();
  await expect(tiles).toHaveCount(2);
  const rectTool = page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true });
  const svg = stage.locator('svg').first();
  const box = (await svg.boundingBox())!;
  await rectTool.click();
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 120);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Select' }).click();
  await expect(stage.locator('[data-savig-object]')).toHaveCount(1);

  // Both scenes 1s long → master [0,2): scene 1 owns [0,1), scene 2 owns [1,2).
  await page.getByLabel('Scene duration').nth(0).fill('1');
  await page.getByLabel('Scene duration').nth(1).fill('1');

  // Back to (empty) scene 1.
  await tiles.nth(0).getByRole('button', { name: /^Scene/ }).click();
  await expect(stage.locator('[data-savig-object]')).toHaveCount(0);

  // Scrub the master bar to ~90% → master 1.8 → scene 2 auto-selected → the rect appears.
  const bar = page.getByTestId('master-bar');
  const barBox = (await bar.boundingBox())!;
  await page.mouse.click(barBox.x + barBox.width * 0.9, barBox.y + barBox.height / 2);
  await expect(stage.locator('[data-savig-object]')).toHaveCount(1);

  // Scrub back to ~10% → master 0.2 → scene 1 again.
  await page.mouse.click(barBox.x + barBox.width * 0.1, barBox.y + barBox.height / 2);
  await expect(stage.locator('[data-savig-object]')).toHaveCount(0);

  // Master play: toggle ON, press Play from scene 1 — playback must CROSS into scene 2
  // (rect appears without any manual scene click) and stop at the master end.
  await page.getByTestId('master-toggle').click();
  await expect(page.getByTestId('master-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(stage.locator('[data-savig-object]')).toHaveCount(1, { timeout: 5000 });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible({ timeout: 8000 }); // ended → Pause reverted to Play
});
