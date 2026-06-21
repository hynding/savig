import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

test('keyframe fill color -> export -> bundle animates the fill', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect (same flow as the draw-vector e2e).
  await page.getByRole('button', { name: 'Rectangle' }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 160);
  await page.mouse.up();
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object]')).toHaveCount(1);

  // Keyframe fill at t=0 (#ff0000) and a later time (#0000ff). autoKey defaults on.
  await page.getByTestId('timeline-ruler').click({ position: { x: 0, y: 10 } });
  await page.getByLabel('fill', { exact: true }).fill('#ff0000');
  await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } });
  await page.getByLabel('fill', { exact: true }).fill('#0000ff');

  // Export and read the bundle.
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
  const exported = await page.context().newPage();
  await exported.goto(pathToFileURL(join(dir, 'index.html')).href);
  const shape = exported.locator('[data-savig-object] rect').first();
  await expect(shape).toHaveCount(1);
  const f0 = await shape.getAttribute('fill');
  let changed = false;
  for (let i = 0; i < 6; i++) {
    await exported.waitForTimeout(120);
    if ((await shape.getAttribute('fill')) !== f0) changed = true;
  }
  expect(changed).toBe(true); // the exported fill animates
});
