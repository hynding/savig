import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

test('draw a motion path -> export -> exported bundle moves the object along the guide', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect (same flow as the color-animation e2e). It becomes the selected object.
  await page.getByRole('button', { name: 'Rectangle' }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 120);
  await page.mouse.up();
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object]')).toHaveCount(1);

  // Activate the Motion Path tool and draw a guide in empty stage area (away from the
  // rect so the clicks land on the canvas, not the object): two clicks + a double-click
  // to finish. The guide commits to the selected rect with a seeded 0->1 progress track.
  await page.getByRole('button', { name: 'Motion Path', exact: true }).click();
  await page.mouse.click(box.x + 220, box.y + 200);
  await page.mouse.click(box.x + 320, box.y + 240);
  await page.mouse.dblclick(box.x + 420, box.y + 200);

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

  // Open the exported bundle; the wrapper transform should change over time as the
  // object follows the guide (the runtime auto-plays from t=0).
  const exported = await page.context().newPage();
  await exported.goto(pathToFileURL(join(dir, 'index.html')).href);
  const wrapper = exported.locator('[data-savig-object]').first();
  await expect(wrapper).toHaveCount(1);
  const t0 = await wrapper.getAttribute('transform');
  let changed = false;
  for (let i = 0; i < 6; i++) {
    await exported.waitForTimeout(120);
    if ((await wrapper.getAttribute('transform')) !== t0) changed = true;
  }
  expect(changed).toBe(true); // the exported object moves along the motion path
});
