import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

test('draw path with pen -> keyframe x -> export -> exported bundle animates', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Select the pen tool and author a path: two clicks, then double-click to finish.
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.click(box.x + 80, box.y + 80);
  await page.mouse.click(box.x + 180, box.y + 120);
  await page.mouse.dblclick(box.x + 240, box.y + 80);
  // Exactly one path object is created by the pen session.
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object]')).toHaveCount(1);

  // The new path is selected. Key x at two times so the wrapper transform animates.
  await expect(page.getByText(/nodes:/i)).toBeVisible();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const xField = page.getByLabel('x', { exact: true });
  await expect(xField).toBeEnabled();
  await xField.fill('100');
  await xField.blur();
  await page.getByTestId('timeline-ruler').click({ position: { x: 100, y: 10 } });
  await xField.fill('400');
  await xField.blur();

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

  // Open the exported bundle; assert a <path> exists and the wrapper transform animates.
  const exported = await page.context().newPage();
  await exported.goto(pathToFileURL(join(dir, 'index.html')).href);
  const wrapper = exported.locator('[data-savig-object]').first();
  await expect(wrapper).toHaveCount(1);
  await expect(exported.locator('[data-savig-object] path').first()).toHaveCount(1);
  const t0 = await wrapper.getAttribute('transform');
  await exported.waitForTimeout(500); // runtime auto-plays
  const t1 = await wrapper.getAttribute('transform');
  expect(t1).not.toBe(t0);
});
