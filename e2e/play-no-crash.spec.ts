import { test, expect } from '@playwright/test';

// Regression: clicking Play must not crash the app. The playback controller invokes an injected
// `raf` port as `deps.raf(...)`; if the adapter passes the bare native `requestAnimationFrame`
// (unbound from `window`), the browser throws `TypeError: Illegal invocation`, unmounting <App>
// (blank white page).
test('play: pressing Play advances the playhead without crashing the app', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(300);

  // The app is still mounted (no white-page crash) …
  await expect(page.locator('section[aria-label="Stage"]')).toBeVisible();
  // … the button flipped to Pause (playback actually started) …
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  // … and no uncaught error was thrown.
  expect(pageErrors).toEqual([]);
});
