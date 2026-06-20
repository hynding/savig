import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

test('draw rect -> keyframe width -> export -> exported bundle animates geometry', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Select the rectangle tool and draw on the stage.
  await page.getByRole('button', { name: 'Rectangle' }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 160);
  await page.mouse.up();

  // The new object is selected; key width=120 at t=0 and width=240 at t=1.
  const widthField = page.getByLabel('width', { exact: true });
  await widthField.fill('120');
  await widthField.blur();
  await page.getByTestId('timeline-ruler').click({ position: { x: 100, y: 10 } });
  await widthField.fill('240');
  await widthField.blur();

  // Export and capture the bundle.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const c of stream as NodeJS.ReadableStream) chunks.push(c as Buffer);
  const zipBytes = new Uint8Array(Buffer.concat(chunks));

  const dir = mkdtempSync(join(tmpdir(), 'savig-e2e-'));
  const files = unzipSync(zipBytes);
  for (const [path, data] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }
  expect(Object.keys(files)).toContain('index.html');

  // Open the exported bundle; assert the inner rect's width animates.
  const exported = await page.context().newPage();
  await exported.goto(pathToFileURL(join(dir, 'index.html')).href);
  const rect = exported.locator('[data-savig-object] rect').first();
  await expect(rect).toHaveCount(1);
  const w0 = await rect.getAttribute('width');
  await exported.waitForTimeout(500); // runtime auto-plays
  const w1 = await rect.getAttribute('width');
  expect(w1).not.toBe(w0);
});
