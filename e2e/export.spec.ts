import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

test('import -> keyframe -> export -> exported bundle animates', async ({ page }) => {
  // Force the anchor-download fallback so the export is a capturable browser
  // download rather than a native File System Access picker (which hangs headless).
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Import the fixture SVG and instance it.
  await page.getByLabel('Import SVG').setInputFiles('e2e/fixtures/box.svg');
  await page.getByRole('button', { name: 'box.svg' }).click();

  // Key x=20 at t=0 and x=200 at t=1 so the object actually moves between them.
  // (A single keyframe would clamp to a constant value — no animation to assert.)
  const xField = page.getByLabel('x', { exact: true });
  await xField.fill('20');
  await xField.blur();
  // Move the playhead to 1s (PX_PER_SECOND = 100 -> x=100) and key x again.
  await page.getByTestId('timeline-ruler').click({ position: { x: 100, y: 10 } });
  await xField.fill('200');
  await xField.blur();

  // Export and capture the download.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const zipBytes = new Uint8Array(Buffer.concat(chunks));

  // Unzip the bundle to a temp dir, preserving entry paths.
  const dir = mkdtempSync(join(tmpdir(), 'savig-e2e-'));
  const files = unzipSync(zipBytes);
  for (const [path, data] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }
  expect(Object.keys(files)).toContain('index.html');

  // Open the exported index.html and assert the object animates over time.
  const exported = await page.context().newPage();
  await exported.goto(pathToFileURL(join(dir, 'index.html')).href);
  const node = exported.locator('[data-savig-object]').first();
  await expect(node).toHaveCount(1);

  const t0 = await node.getAttribute('transform');
  await exported.waitForTimeout(500); // runtime auto-plays on load
  const t1 = await node.getAttribute('transform');
  expect(t1).not.toBe(t0); // transform changed -> it animated
});
