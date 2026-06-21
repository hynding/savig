import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

test('toggle resampled morph -> export -> exported path animates with a dense point set', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Author a path (pen) and create two shape keyframes (same flow as the morph e2e).
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.click(box.x + 80, box.y + 80);
  await page.mouse.click(box.x + 180, box.y + 120);
  await page.mouse.dblclick(box.x + 240, box.y + 80);
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object]')).toHaveCount(1);

  await page.getByRole('button', { name: /add shape keyframe/i }).click();
  await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } });
  const node = page.getByTestId('node-1');
  const nb = (await node.boundingBox())!;
  await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
  await page.mouse.down();
  await page.mouse.move(nb.x + 60, nb.y + 60);
  await page.mouse.up();
  await expect(page.getByText(/morph: 2 keyframe/i)).toBeVisible();

  // Select the FIRST shape keyframe (the from-keyframe at t=0) and set it to Resample.
  await page.locator('[data-testid^="shape-keyframe-"]').first().click();
  await page.getByLabel('morph mode').selectOption('resampled');

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

  // Open the bundle; sample the inner <path> `d` across playback. A resampled morph
  // renders a dense ~64-point polygon mid-morph (many `L` commands), unlike index-pad.
  const exported = await page.context().newPage();
  await exported.goto(pathToFileURL(join(dir, 'index.html')).href);
  const pathLoc = exported.locator('[data-savig-object] path').first();
  await expect(pathLoc).toHaveCount(1);
  const d0 = await pathLoc.getAttribute('d');
  let maxL = 0;
  let changed = false;
  for (let i = 0; i < 6; i++) {
    await exported.waitForTimeout(120);
    const d = (await pathLoc.getAttribute('d')) ?? '';
    maxL = Math.max(maxL, (d.match(/L/g) ?? []).length);
    if (d !== d0) changed = true;
  }
  expect(changed).toBe(true); // the morph animates
  expect(maxL).toBeGreaterThanOrEqual(40); // dense resampled point set, not index-pad
});
