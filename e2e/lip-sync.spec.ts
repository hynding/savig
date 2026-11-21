import { test, expect } from '@playwright/test';

/** A 1 s mono WAV: silent first half, a loud tone in the second half. */
function voiceWav(): Buffer {
  const sampleRate = 8000;
  const n = sampleRate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = i < n / 2 ? 0 : Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 24000);
    buf.writeInt16LE(v, 44 + i * 2);
  }
  return buf;
}

/** Audio lip sync (roadmap 12): a two-pose mouth symbol (frame layer: closed, open) is keyed from
 *  a voice clip — closed while silent, open while loud. */
test('sync a mouth symbol to a voice clip', async ({ page }) => {
  await page.goto('/');
  const stage = page.locator('section[aria-label="Stage"]');
  const box = (await stage.locator('svg').first().boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });

  // Frame layer with two poses: a rectangle (rest), then an ellipse (open).
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByLabel('Command search').fill('new frame-by-frame layer');
  await palette.getByLabel('Command search').press('Enter');
  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 120);
  await page.mouse.up();
  await page.keyboard.press('.');
  await page.keyboard.press('F7');
  await tools.getByRole('button', { name: 'Ellipse', exact: true }).click();
  await page.mouse.move(box.x + 100, box.y + 90);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 140);
  await page.mouse.up();

  // Make the layer a symbol (select it in the Layers panel first).
  await page.locator('[aria-label="Layers"] [data-testid^="layer-"]').first().click();
  await page.keyboard.press('Control+k');
  await palette.getByLabel('Command search').fill('create symbol');
  await palette.getByLabel('Command search').press('Enter');
  await expect(stage.locator('[data-savig-object*="/"]').first()).toBeAttached();

  // Import the voice and place its clip.
  await page.getByLabel('Import Audio').setInputFiles({ name: 'voice.wav', mimeType: 'audio/wav', buffer: voiceWav() });
  const assets = page.locator('section[aria-label="Assets"]');
  await assets.locator('[data-testid^="asset-"]').filter({ hasText: 'voice.wav' }).click();
  await page.getByTestId(/^audio-clip-/).waitFor();

  // Select the mouth instance again and sync.
  await page.locator('[aria-label="Layers"] [data-testid^="layer-"]').first().click();
  const section = page.getByTestId('lip-sync-section');
  await expect(section.getByTestId('lip-sync-clip')).toContainText('voice.wav');
  await section.getByTestId('lip-sync-run').click();
  await expect(section.getByTestId('lip-sync-result')).toHaveText(/Synced \d+ frames to 2 poses/);

  // Vowel shapes (roadmap 13): unlabeled poses are used in the default order; the sync runs the
  // spectral analysis in the browser and keys the same instance.
  await expect(section.getByTestId('lip-sync-mode')).toHaveValue('loudness');
  await section.getByTestId('lip-sync-mode').selectOption('vowels');
  await expect(section.getByTestId('lip-sync-shapes')).toContainText('No shape labels');
  await section.getByTestId('lip-sync-run').click();
  await expect(section.getByTestId('lip-sync-result')).toHaveText(/Synced \d+ frames to 2 mouth shapes/);

  // Undo removes the keys (the result line stays, the Inspector re-reads the instance).
  await stage.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
});
