import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

test('per-node easing: one node eases differently and the exported morph reflects it', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Author a path and two shape keyframes (same flow as the morph e2e).
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

  // Go to the first keyframe, select node 0, set its easing to easeIn.
  await page.getByTestId('timeline-ruler').click({ position: { x: 0, y: 10 } });
  await page.getByTestId('node-0').click();
  await expect(page.getByText(/node 0 — overrides keyframe easing/)).toBeVisible();
  // The Node-easing editor renders after the Keyframe-easing editor, so its preset is last.
  await page.getByRole('button', { name: 'easeIn' }).last().click();
  await expect(page.getByTestId('node-easing-marker-0')).toBeVisible();

  // Export and confirm the exported morph animates (the per-node-eased transition).
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
  const pathLoc = exported.locator('[data-savig-object] path').first();
  await expect(pathLoc).toHaveCount(1);
  const d0 = await pathLoc.getAttribute('d');
  let changed = false;
  for (let i = 0; i < 6; i++) {
    await exported.waitForTimeout(120);
    if ((await pathLoc.getAttribute('d')) !== d0) changed = true;
  }
  expect(changed).toBe(true);
});
