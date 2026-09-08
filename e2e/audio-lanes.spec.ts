import { test, expect } from '@playwright/test';
import { makeWav } from './util/wav';

test('import audio → clip lands with real duration; add track; M/S/gain react', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Import Audio').setInputFiles({ name: 't.wav', mimeType: 'audio/wav', buffer: makeWav() });
  // Importing only stamps the asset; clicking the placed asset button creates the clip.
  const assetsPanel = page.locator('section[aria-label="Assets"]');
  const assetButton = assetsPanel.locator('[data-testid^="asset-"]');
  await assetButton.click();

  const clip = page.getByTestId(/^audio-clip-/);
  await clip.waitFor();
  // width > 3px proves outPoint > 0 (the defect fix): zero-length clips rendered 2px before.
  const width = await clip.evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(3);

  // Waveform renders: the clip's <svg data-testid="clip-waveform-<id>"> mounts with a real <path>
  // once getPeaks decodes the imported WAV (proves the OfflineAudioContext cache wired through).
  const clipId = (await clip.getAttribute('data-testid'))!.replace('audio-clip-', '');
  const waveformPath = page.getByTestId(`clip-waveform-${clipId}`).locator('path');
  await expect(waveformPath).toHaveCount(1);
  await expect(waveformPath).toHaveAttribute('d', /M 0 1/);

  await page.getByTestId('add-audio-track').click();
  await expect(page.getByTestId(/^audio-lane-/)).toHaveCount(2);

  const trackId = await page.getByTestId(/^audio-lane-/).nth(1).getAttribute('data-testid');
  const laneSuffix = trackId!.replace('audio-lane-', '');

  const muteBtn = page.getByTestId(`audio-track-mute-${laneSuffix}`);
  await expect(muteBtn).toHaveAttribute('aria-pressed', 'false');
  await muteBtn.click();
  await expect(muteBtn).toHaveAttribute('aria-pressed', 'true');

  const soloBtn = page.getByTestId(`audio-track-solo-${laneSuffix}`);
  await expect(soloBtn).toHaveAttribute('aria-pressed', 'false');
  await soloBtn.click();
  await expect(soloBtn).toHaveAttribute('aria-pressed', 'true');

  const gainInput = page.getByTestId(`audio-track-gain-${laneSuffix}`);
  await gainInput.fill('0.4');
  await expect(gainInput).toHaveValue('0.4');
});

test('dragging the fade-in handle shows the fade overlay ramp', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Import Audio').setInputFiles({ name: 't.wav', mimeType: 'audio/wav', buffer: makeWav() });
  const assetsPanel = page.locator('section[aria-label="Assets"]');
  await assetsPanel.locator('[data-testid^="asset-"]').click();

  const clip = page.getByTestId(/^audio-clip-/);
  await clip.waitFor();
  const clipId = (await clip.getAttribute('data-testid'))!.replace('audio-clip-', '');

  const overlay = page.getByTestId(`fade-overlay-${clipId}`);
  await expect(overlay).toHaveCount(0); // no fade set yet

  const handle = page.getByTestId(`fade-in-handle-${clipId}`);
  const box = (await handle.boundingBox())!;
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 30, startY, { steps: 5 }); // drag ~30px right -> fadeIn grows
  await page.mouse.up();

  await expect(overlay).toHaveCount(1);
  await expect(overlay.locator('polyline')).toHaveCount(1);
});

test('selecting a mixer lane sets a track filter that survives deselect/reselect', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-audio-track').click();

  const lane = page.getByTestId(/^audio-lane-/).first();
  const laneHeader = lane.locator('span').first(); // the lane name label, inside laneHeader
  await laneHeader.click();

  const kindSelect = page.getByTestId('track-filter-kind');
  await expect(kindSelect).toBeVisible();
  await kindSelect.selectOption('lowpass');

  const freqInput = page.getByTestId('track-filter-freq');
  await expect(freqInput).toHaveValue('1000');

  // Deselect (click the same lane header again toggles the selection off) — the Track panel
  // (and its filter controls) disappears with it.
  await laneHeader.click();
  await expect(kindSelect).toHaveCount(0);

  // Reselect: the freq field re-reads the persisted store value, not some stale local default.
  await laneHeader.click();
  await expect(page.getByTestId('track-filter-freq')).toHaveValue('1000');
});
