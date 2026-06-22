import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';

test('a rounded polygon exports with curved (C) corners', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Pick the Polygon tool and dial in a corner radius before stamping.
  await page.getByRole('button', { name: 'Polygon', exact: true }).click();
  await page.getByLabel('Corner radius').fill('15');

  // Stamp a polygon: center-out drag (center -> radius point).
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const cx = box.x + 160;
  const cy = box.y + 160;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 80); // 80px radius
  await page.mouse.up();
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object]')).toHaveCount(1);

  // The on-canvas path is already a rounded (cubic) path.
  const onCanvasD = await page.locator('[data-savig-object] path').first().getAttribute('d');
  expect(onCanvasD).toContain('C');

  // Export and confirm the rounding round-trips into the bundle.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream as NodeJS.ReadableStream) chunks.push(c as Buffer);
  const files = unzipSync(new Uint8Array(Buffer.concat(chunks)));
  expect(Object.keys(files)).toContain('index.html');
  const html = new TextDecoder().decode(files['index.html']);
  // A sharp polygon's d is M/L/Z only; the C proves the exported corners are rounded.
  expect(html).toMatch(/<path[^>]*\bd="[^"]*C/);
});
