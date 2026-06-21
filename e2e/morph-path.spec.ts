import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

test('draw path -> key shape at two times -> export -> exported path d animates', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Author a path (pen): two clicks + double-click to finish; switches to node tool.
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.click(box.x + 80, box.y + 80);
  await page.mouse.click(box.x + 180, box.y + 120);
  await page.mouse.dblclick(box.x + 240, box.y + 80);
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object]')).toHaveCount(1);

  // Opt into morphing: snapshot the shape at t=0.
  await page.getByRole('button', { name: /add shape keyframe/i }).click();

  // Move the playhead, then drag a node to create a second shape keyframe.
  await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } });
  const node = page.getByTestId('node-1');
  const nb = (await node.boundingBox())!;
  await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
  await page.mouse.down();
  await page.mouse.move(nb.x + 60, nb.y + 60);
  await page.mouse.up();
  // Two shape keyframes now exist on the object.
  await expect(page.getByText(/morph: 2 keyframe/i)).toBeVisible();

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

  // Open the bundle; the runtime auto-plays, so the inner <path> `d` must change.
  const exported = await page.context().newPage();
  await exported.goto(pathToFileURL(join(dir, 'index.html')).href);
  const path = exported.locator('[data-savig-object] path').first();
  await expect(path).toHaveCount(1);
  const d0 = await path.getAttribute('d');
  await exported.waitForTimeout(500);
  const d1 = await path.getAttribute('d');
  expect(d1).not.toBe(d0);
});
