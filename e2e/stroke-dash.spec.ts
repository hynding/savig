import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

test('draw-on a dashed rect -> export -> bundle animates stroke-dashoffset', async ({ page }) => {
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

  // Seek to 0, then Draw on (seeds dasharray [1,1] + offset keyframes 1->0).
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
  expect(indexHtml).toMatch(/stroke-dasharray="1 1"/);

  // Drive the standalone runtime: stroke-dashoffset must change over time.
  const exported = await page.context().newPage();
  await exported.goto(pathToFileURL(join(dir, 'index.html')).href);
  const shape = exported.locator('[data-savig-object] rect').first();
  await expect(shape).toHaveCount(1);
  const d0 = await shape.getAttribute('stroke-dashoffset');
  let changed = false;
  for (let i = 0; i < 6; i++) {
    await exported.waitForTimeout(120);
    if ((await shape.getAttribute('stroke-dashoffset')) !== d0) changed = true;
  }
  expect(changed).toBe(true); // the exported stroke-dashoffset animates
});
