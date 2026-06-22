import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

test('a 2->3 stop gradient keyframe pair morphs across stop count in the export', async ({ page }) => {
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
  await page.mouse.move(box.x + 240, box.y + 180);
  await page.mouse.up();
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object]')).toHaveCount(1);

  // t=0: assign a linear gradient (2 default stops) -> a gradient keyframe with 2 stops.
  await page.getByTestId('timeline-ruler').click({ position: { x: 0, y: 10 } });
  await page.getByLabel('fill paint').selectOption('linear');
  await page.getByLabel('fill stop 0 color').fill('#ff0000');

  // t~=2s: add a 3rd stop -> a gradient keyframe with 3 stops (different count).
  await page.getByTestId('timeline-ruler').click({ position: { x: 200, y: 10 } });
  await page.getByLabel('add fill stop').click();

  // Export and unpack.
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
  expect(Object.keys(files)).toContain('index.html');

  // Drive the standalone runtime: during the morph the gradient is reconciled to 3
  // interpolated stops (a STEPS-hold would show only 2 until the snap), and a stop
  // colour animates.
  const exported = await page.context().newPage();
  await exported.goto(pathToFileURL(join(dir, 'index.html')).href);
  const stops = exported.locator('linearGradient stop');
  // Signature = every stop's colour joined; captures both the 2->3 count change and the
  // inserted middle stop evolving (colinear -> #888888) during the morph.
  const signature = async () => (await stops.evaluateAll((els) => els.map((e) => e.getAttribute('stop-color')).join(',')));
  const sig0 = await signature();
  let maxStops = await stops.count();
  let changed = false;
  for (let i = 0; i < 16; i++) {
    await exported.waitForTimeout(100);
    maxStops = Math.max(maxStops, await stops.count());
    if ((await signature()) !== sig0) changed = true;
  }
  expect(maxStops).toBe(3); // count-morphed mid-animation (not held at 2)
  expect(changed).toBe(true); // the reconciled stops animate over time
});
