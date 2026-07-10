import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

test('draw-on a rect -> export -> bundle animates the trim stroke-dasharray window', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect.
  await page.getByRole('button', { name: 'Rectangle' }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 170);
  await page.mouse.up();
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object]')).toHaveCount(1);

  // Seek to 0, then Draw on (seeds trim.endTrack 0 -> 1 over 1s).
  await page.getByTestId('timeline-ruler').click({ position: { x: 0, y: 10 } });
  await page.getByRole('button', { name: 'Draw on' }).click();

  // Export + unpack.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream as NodeJS.ReadableStream) chunks.push(c as Buffer);
  const dir = mkdtempSync(join(tmpdir(), 'savig-e2e-'));
  const files = unzipSync(new Uint8Array(Buffer.concat(chunks)));
  for (const [p, data] of Object.entries(files)) {
    const full = join(dir, p);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }
  const indexHtml = Buffer.from(files['index.html']).toString('utf8');
  expect(indexHtml).toContain('pathLength="1"');
  // At t=0 the trim window is fully closed (endTrack starts at 0).
  expect(indexHtml).toMatch(/stroke-dasharray="0 1"/);

  // Drive the standalone runtime: stroke-dasharray must animate from "0 1" to "1 0" as the
  // trim end track opens the stroke window (dashoffset stays put since start/offset are 0).
  const exported = await page.context().newPage();
  await exported.goto(pathToFileURL(join(dir, 'index.html')).href);
  const shape = exported.locator('[data-savig-object] rect').first();
  await expect(shape).toHaveCount(1);
  let sawFull = false;
  for (let i = 0; i < 20; i++) {
    await exported.waitForTimeout(120);
    if ((await shape.getAttribute('stroke-dasharray')) === '1 0') {
      sawFull = true;
      break;
    }
  }
  expect(sawFull).toBe(true); // the exported stroke-dasharray animates open to "1 0"
});
