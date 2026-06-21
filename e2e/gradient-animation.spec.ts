import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

test('animate a gradient stop color -> export -> bundle animates the <stop>', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect (same flow as the gradient-export e2e).
  await page.getByRole('button', { name: 'Rectangle' }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 170);
  await page.mouse.up();
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object]')).toHaveCount(1);

  // autoKey defaults on: assigning a linear gradient + editing a stop keyframes it.
  await page.getByTestId('timeline-ruler').click({ position: { x: 0, y: 10 } });
  await page.getByLabel('fill paint').selectOption('linear');
  await page.getByLabel('fill stop 0 color').fill('#ff0000'); // gradient kf @ t=0

  await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } });
  await page.getByLabel('fill stop 0 color').fill('#0000ff'); // gradient kf @ later time

  // Stage previews the animated gradient via url(#…).
  await expect(page.locator('[data-savig-object] rect').first()).toHaveAttribute(
    'fill',
    /url\(#savig-grad-[^)]+-fill\)/,
  );

  // Export and unpack the bundle.
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

  // The exported HTML carries the gradient def + a url() reference.
  const indexHtml = files['index.html'] ? Buffer.from(files['index.html']).toString('utf8') : '';
  expect(indexHtml).toContain('<linearGradient id="savig-grad-');
  expect(indexHtml).toMatch(/fill="url\(#savig-grad-[^"]+-fill\)"/);

  // Drive the standalone runtime: the first stop's stop-color must change over time.
  const exported = await page.context().newPage();
  await exported.goto(pathToFileURL(join(dir, 'index.html')).href);
  const stop = exported.locator('linearGradient stop').first();
  await expect(stop).toHaveCount(1);
  const c0 = await stop.getAttribute('stop-color');
  let changed = false;
  for (let i = 0; i < 6; i++) {
    await exported.waitForTimeout(120);
    if ((await stop.getAttribute('stop-color')) !== c0) changed = true;
  }
  expect(changed).toBe(true); // the exported gradient stop animates
});
