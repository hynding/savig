/**
 * Multitrack audio (Task 8): comprehensive e2e over lanes, waveforms, fades, mixer
 * controls (mute/solo/gain/pan), track reassignment, play-smoke, the animated-SVG
 * round-trip, and legacy-project parity. Mirrors the idioms already established by
 * `audio-lanes.spec.ts` (import/place/drag), `play-no-crash.spec.ts` (native-binding
 * regression guard), and `open-svg-roundtrip.spec.ts` (export/reopen plumbing). Each
 * test is independent — a fresh `page.goto('/')` per test, no shared state.
 */
import { expect, test } from '@playwright/test';
import { makeWav } from './util/wav';

async function importAndPlaceClip(page: import('@playwright/test').Page) {
  await page.getByLabel('Import Audio').setInputFiles({ name: 't.wav', mimeType: 'audio/wav', buffer: makeWav() });
  const assetsPanel = page.locator('section[aria-label="Assets"]');
  await assetsPanel.locator('[data-testid^="asset-"]').click();
  const clip = page.getByTestId(/^audio-clip-/);
  await clip.waitFor();
  return clip;
}

test('1. import wav → place clip → waveform path renders inside the clip block', async ({ page }) => {
  await page.goto('/');
  const clip = await importAndPlaceClip(page);
  const clipId = (await clip.getAttribute('data-testid'))!.replace('audio-clip-', '');
  const waveform = page.getByTestId(`clip-waveform-${clipId}`);
  await expect(waveform).toHaveCount(1);
  // The waveform <svg> must be a descendant of the clip block, not a sibling overlay.
  await expect(clip.locator(`[data-testid="clip-waveform-${clipId}"]`)).toHaveCount(1);
  await expect(waveform.locator('path')).toHaveAttribute('d', /M 0 1/);
});

test('2. two tracks: solo/gain toggle correctly and survive reload (autosave)', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  await page.getByTestId('add-audio-track').click();
  await page.getByTestId('add-audio-track').click();
  const lanes = page.getByTestId(/^audio-lane-/);
  await expect(lanes).toHaveCount(2); // no default lane: no clips yet, 2 real tracks

  const t1Id = (await lanes.nth(0).getAttribute('data-testid'))!.replace('audio-lane-', '');
  const t2Id = (await lanes.nth(1).getAttribute('data-testid'))!.replace('audio-lane-', '');

  const solo1 = page.getByTestId(`audio-track-solo-${t1Id}`);
  await expect(solo1).toHaveAttribute('aria-pressed', 'false');
  await solo1.click();
  await expect(solo1).toHaveAttribute('aria-pressed', 'true');
  // t2's solo state is untouched by t1's toggle.
  await expect(page.getByTestId(`audio-track-solo-${t2Id}`)).toHaveAttribute('aria-pressed', 'false');

  const gain1 = page.getByTestId(`audio-track-gain-${t1Id}`);
  await gain1.fill('0.35');
  await expect(gain1).toHaveValue('0.35');

  const pan2 = page.getByTestId(`audio-track-pan-${t2Id}`);
  await pan2.fill('-0.5');
  await expect(pan2).toHaveValue('-0.5');

  // Reload: IndexedDB autosave (1s debounce) restores the project — mirrors the pattern
  // established by keyframe-easing.spec.ts / correspondence.spec.ts.
  await page.waitForTimeout(1300);
  await page.reload();
  await expect(page.getByTestId(/^audio-lane-/)).toHaveCount(2);
  await expect(page.getByTestId(`audio-track-solo-${t1Id}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId(`audio-track-gain-${t1Id}`)).toHaveValue('0.35');
  await expect(page.getByTestId(`audio-track-pan-${t2Id}`)).toHaveValue('-0.5');
});

test('3. dragging a clip from the default lane onto a track lane reassigns it', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-audio-track').click();
  const trackId = (await page.getByTestId(/^audio-lane-/).nth(0).getAttribute('data-testid'))!.replace(
    'audio-lane-',
    '',
  );

  const clip = await importAndPlaceClip(page);
  // The freshly-placed clip has no trackId -> lives in the default lane (index 0), with the
  // real track at index 1 (untracked.length>0 keeps the default lane visible).
  await expect(page.locator(`[data-testid="audio-lane-default"] [data-testid^="audio-clip-"]`)).toHaveCount(1);

  const box = (await clip.boundingBox())!;
  const startX = box.x + box.width / 2; // clear of the 6px edge (trim) zones
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Vertical drag of a full lane height (34px) with ~0 horizontal delta -> reassign, not retime.
  await page.mouse.move(startX, startY + 40, { steps: 6 });
  await page.mouse.up();

  await expect(page.locator(`[data-testid="audio-lane-${trackId}"] [data-testid^="audio-clip-"]`)).toHaveCount(1);
  await expect(page.locator(`[data-testid="audio-lane-default"] [data-testid^="audio-clip-"]`)).toHaveCount(0);
});

test('4. trim narrows a clip; dragging the fade-in handle shows the fade overlay', async ({ page }) => {
  await page.goto('/');
  const clip = await importAndPlaceClip(page);

  const before = (await clip.boundingBox())!;
  // Grab within the 6px right-edge trim zone and drag left -> outPoint shrinks -> width shrinks.
  const edgeX = before.x + before.width - 3;
  const edgeY = before.y + before.height / 2;
  await page.mouse.move(edgeX, edgeY);
  await page.mouse.down();
  await page.mouse.move(edgeX - 20, edgeY, { steps: 5 });
  await page.mouse.up();

  const after = (await clip.boundingBox())!;
  expect(after.width).toBeLessThan(before.width);

  const clipId = (await clip.getAttribute('data-testid'))!.replace('audio-clip-', '');
  const overlay = page.getByTestId(`fade-overlay-${clipId}`);
  await expect(overlay).toHaveCount(0); // no fade set yet

  const handle = page.getByTestId(`fade-in-handle-${clipId}`);
  const hbox = (await handle.boundingBox())!;
  const hx = hbox.x + hbox.width / 2;
  const hy = hbox.y + hbox.height / 2;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx + 10, hy, { steps: 5 });
  await page.mouse.up();

  await expect(overlay).toHaveCount(1);
  await expect(overlay.locator('polyline')).toHaveCount(1);
});

test('5. PLAY smoke: placing a clip and pressing Play advances the playhead without crashing', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  await importAndPlaceClip(page);

  const playhead = page.getByTestId('playhead');
  const xBefore = await playhead.evaluate((el) => parseFloat((el as HTMLElement).style.left || '0'));

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(500);

  // App root still mounted (no white-page crash from the native-binding regression class) …
  await expect(page.locator('section[aria-label="Stage"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  // … the playhead actually advanced …
  const xAfter = await playhead.evaluate((el) => parseFloat((el as HTMLElement).style.left || '0'));
  expect(xAfter).toBeGreaterThan(xBefore);
  // … and nothing threw.
  expect(pageErrors).toEqual([]);
});

test('6. round-trip: export animated SVG, reopen, audio track name + fade survive', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __savedChunks?: Uint8Array[];
      showSaveFilePicker?: unknown;
      showOpenFilePicker?: unknown;
    };
    w.__savedChunks = [];
    w.showSaveFilePicker = async () => ({
      createWritable: async () => ({
        write: async (data: Uint8Array) => {
          w.__savedChunks!.push(data);
        },
        close: async () => {},
      }),
    });
    delete w.showOpenFilePicker;
    window.confirm = () => true;
  });
  await page.goto('/');

  await page.getByTestId('add-audio-track').click();
  const trackId = (await page.getByTestId(/^audio-lane-/).first().getAttribute('data-testid'))!.replace(
    'audio-lane-',
    '',
  );
  // Rename the track (double-click the label -> rename input -> blur commits).
  await page.locator(`[data-testid="audio-lane-${trackId}"] span`).first().dblclick();
  const renameInput = page.getByTestId(`audio-track-rename-${trackId}`);
  await renameInput.fill('Voiceover');
  await renameInput.blur();
  await expect(page.locator(`[data-testid="audio-lane-${trackId}"]`)).toContainText('Voiceover');

  const clip = await importAndPlaceClip(page);
  const clipId = (await clip.getAttribute('data-testid'))!.replace('audio-clip-', '');

  const handle = page.getByTestId(`fade-in-handle-${clipId}`);
  const hbox = (await handle.boundingBox())!;
  await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2);
  await page.mouse.down();
  await page.mouse.move(hbox.x + hbox.width / 2 + 10, hbox.y + hbox.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId(`fade-overlay-${clipId}`)).toHaveCount(1);

  // Export the animated SVG via the command palette (same idiom as open-svg-roundtrip.spec.ts).
  await page.locator('section[aria-label="Stage"]').click();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByLabel('Command search').fill('export animated svg');
  await palette.getByLabel('Command search').press('Enter');
  await page.waitForFunction(() => (window as unknown as { __savedChunks: Uint8Array[] }).__savedChunks.length > 0);

  // Reset to blank BEFORE reopening so the post-open state is attributable to the reopen. A
  // blank project has no tracks, so the implicit default lane is the ONLY lane — the renamed
  // track and the fade overlay are both gone until the reopen restores them.
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.getByTestId(/^audio-lane-/)).toHaveCount(1);
  await expect(page.getByTestId('audio-lane-default')).toBeVisible();

  await page.evaluate(() => {
    const w = window as unknown as { __savedChunks: Uint8Array[]; showOpenFilePicker?: unknown };
    const total = w.__savedChunks.reduce((n, c) => n + c.length, 0);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of w.__savedChunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const file = new File([bytes], 'audio-project.svg', { type: 'image/svg+xml' });
    w.showOpenFilePicker = async () => [{ getFile: async () => file }];
  });
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);

  // Track name and fade overlay both survived the round-trip.
  await expect(page.locator(`[data-testid="audio-lane-${trackId}"]`)).toContainText('Voiceover');
  await expect(page.getByTestId(`fade-overlay-${clipId}`)).toHaveCount(1);
  await expect(page.getByTestId(`fade-overlay-${clipId}`).locator('polyline')).toHaveCount(1);
});

test('7. legacy parity: a template with no audioTracks shows exactly one default lane, no M/S', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New from template' }).click();
  const gallery = page.getByRole('dialog', { name: 'Template gallery' });
  await expect(gallery).toBeVisible();
  await gallery.getByText('Bouncing ball').click();
  await expect(gallery).toBeHidden();

  const lanes = page.getByTestId(/^audio-lane-/);
  await expect(lanes).toHaveCount(1);
  await expect(page.getByTestId('audio-lane-default')).toBeVisible();
  await expect(page.locator('[data-testid^="audio-track-mute-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="audio-track-solo-"]')).toHaveCount(0);
});
