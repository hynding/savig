import { test, expect } from '@playwright/test';
import { makeWav } from './util/wav';

/** Full browser video-export journey (spec §10): author a short 2-scene project, export through
 *  the real dialog, assert container magic bytes. Real ffmpeg.wasm encode. fps is kept small
 *  (12) to keep the single-threaded wasm encode fast — the byte-count/magic-byte assertions
 *  below don't depend on resolution or frame rate.
 *
 *  A CONFIRMED, TWICE-REPRODUCED DEFECT in the vendored wasm core (investigated with the real
 *  ffmpeg 'log' event stream, not guessed): real (rasterized, antialiased) frame content
 *  reliably wasm-traps this vendored @ffmpeg/core@0.12.10 libvpx-vp9 build ("RuntimeError:
 *  memory access out of bounds") at every tested, usable width — with BOTH `-deadline good
 *  -cpu-used 5` and `-deadline realtime -cpu-used 8` — while MP4/libx264 is unaffected (real
 *  content, 320px, with audio). The defect does not depend on resolution, deadline/cpu-used
 *  tuning, or the presence of audio; it is intrinsic to this vendored core's vp9 encoder on
 *  real frame content.
 *
 *  RULING (controller, 2026-09-14): WebM is disabled in the v1 UI (see spec §6 second
 *  amendment); plumbing retained for M10. All WebM argv builders, the single-pass path, and
 *  WEBM_MAX_FRAMES stay implemented and tested for the M10 native-ffmpeg backend (§11), where
 *  the same invocations run on real ffmpeg. Backlog: retry newer @ffmpeg/core releases as they
 *  appear. This file's WebM leg therefore asserts the disabled UI state instead of attempting a
 *  WebM encode. */
test.describe('video export', () => {
  test('exports MP4 (H.264) with playable container magic', async ({ page }) => {
    test.slow(); // wasm core fetch + real encode
    await page.addInitScript(() => {
      const w = window as unknown as { __savedChunks?: Uint8Array[]; showSaveFilePicker?: unknown };
      w.__savedChunks = [];
      w.showSaveFilePicker = async () => ({
        createWritable: async () => ({
          write: async (chunk: Uint8Array) => void w.__savedChunks!.push(chunk),
          close: async () => {},
        }),
      });
    });
    await page.goto('/');

    // ~2s project: scene 1 (1s, animated rect) + scene 2 (1s) + an audio clip.
    const stage = page.locator('section[aria-label="Stage"]');
    const rectTool = page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true });
    const box = (await stage.locator('svg').first().boundingBox())!;
    await rectTool.click();
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 100);
    await page.mouse.up();
    const selectBtn = page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Select', exact: true });
    await selectBtn.click();
    await page.getByRole('button', { name: 'Add scene' }).click();
    await page.getByLabel('Scene duration').nth(0).fill('1');
    await page.getByLabel('Scene duration').nth(1).fill('1');
    await page.getByLabel('Import Audio').setInputFiles({ name: 't.wav', mimeType: 'audio/wav', buffer: makeWav() });
    await page.locator('section[aria-label="Assets"]').locator('[data-testid^="asset-"]').first().click();

    // Palette -> Export Video -> pick format -> Export. Gesture matches the real
    // CommandPalette (apps/react/src/ui/components/CommandPalette/CommandPalette.tsx) and
    // e2e/command-palette.spec.ts: Control+k opens it, input has aria-label "Command search".
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByLabel('Command search').fill('Export Video');
    await palette.getByLabel('Command search').press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Export video' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Format').selectOption('mp4');
    await dialog.getByLabel('Frames per second').fill('12');
    await dialog.getByLabel('Width').fill('320');
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();

    await expect
      .poll(async () => (await page.evaluate(() => (window as unknown as { __savedChunks: Uint8Array[] }).__savedChunks.length)), { timeout: 120_000 })
      .toBeGreaterThan(0);
    const bytes = Buffer.concat(
      (await page.evaluate(() => (window as unknown as { __savedChunks: Uint8Array[] }).__savedChunks.map((c) => Array.from(c)))).map((a) => Buffer.from(a)),
    );
    expect(bytes.length).toBeGreaterThan(2000); // non-trivial encode
    expect(bytes.subarray(4, 8).toString('ascii')).toBe('ftyp');
  });

  test('WebM option is disabled with an explanatory note', async ({ page }) => {
    await page.goto('/');
    await page.locator('section[aria-label="Stage"]').click(); // ensure the page has focus for the shortcut

    // Palette -> Export Video, same gesture as the MP4 leg above.
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByLabel('Command search').fill('Export Video');
    await palette.getByLabel('Command search').press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Export video' });
    await expect(dialog).toBeVisible();
    // toBeDisabled() doesn't recognize <option disabled> the way it does form controls —
    // assert the DOM property directly (equivalent, confirmed via the real element's outerHTML).
    const webmOptionDisabled = await dialog
      .getByLabel('Format')
      .locator('option[value="webm"]')
      .evaluate((el) => (el as HTMLOptionElement).disabled);
    expect(webmOptionDisabled).toBe(true);
    await expect(dialog.getByTestId('webm-disabled-note')).toBeVisible();

    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  });
});
