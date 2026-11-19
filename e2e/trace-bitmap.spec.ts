// Trace Bitmap (spec 2026-11-18-trace-bitmap): an imported picture becomes a group of filled vector
// shapes, one per color, in the picture's place; one undo brings the picture back.
import { test, expect } from '@playwright/test';
import { deflateSync } from 'node:zlib';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** An RGBA PNG painted by `paint`. */
function png(w: number, h: number, paint: (x: number, y: number) => [number, number, number, number]): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) raw.set(paint(x, y), y * (w * 4 + 1) + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('Trace Bitmap turns a two-color picture into two filled shapes; undo restores the picture', async ({ page }) => {
  await page.goto('/');
  const picture = png(40, 30, (x, y) => (Math.hypot(x - 20, y - 15) < 10 ? [20, 40, 220, 255] : [230, 30, 30, 255]));
  await page.getByLabel('Import Image').setInputFiles({ name: 'badge.png', mimeType: 'image/png', buffer: picture });
  const image = page.locator('use[data-savig-object]');
  await expect(image).toHaveCount(1);

  await page.getByTestId('trace-bitmap-open').click();
  await page.getByLabel('colors', { exact: true }).fill('2');
  await page.getByTestId('trace-bitmap-run').click();

  await expect(image).toHaveCount(0);
  const shapes = page.locator('section[aria-label="Stage"] [data-savig-object] path');
  await expect(shapes).toHaveCount(2);
  const paint = await shapes.evaluateAll((els) => els.map((e) => [e.getAttribute('fill'), e.getAttribute('fill-rule')]));
  // Largest first: the red field (with the blue disc cut out of it, evenodd), then the disc.
  expect(paint).toEqual([
    ['#e61e1e', 'evenodd'],
    ['#1428dc', null],
  ]);

  await page.keyboard.press('ControlOrMeta+z');
  await expect(image).toHaveCount(1);
  await expect(shapes).toHaveCount(0);
});

test('Trace Bitmap… in the command palette opens the trace options for the selected picture', async ({ page }) => {
  await page.goto('/');
  const picture = png(40, 30, (x, y) => (Math.hypot(x - 20, y - 15) < 10 ? [20, 40, 220, 255] : [230, 30, 30, 255]));
  await page.getByLabel('Import Image').setInputFiles({ name: 'badge.png', mimeType: 'image/png', buffer: picture });
  await expect(page.locator('use[data-savig-object]')).toHaveCount(1);
  await expect(page.getByTestId('trace-bitmap')).toHaveCount(0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // shortcuts ignore inputs

  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByLabel('Command search').fill('Trace Bitmap');
  await palette.getByLabel('Command search').press('Enter');
  await expect(palette).not.toBeVisible();

  await expect(page.getByTestId('trace-bitmap')).toBeVisible();
  await page.getByLabel('colors', { exact: true }).fill('2');
  await page.getByTestId('trace-bitmap-run').click();
  await expect(page.locator('use[data-savig-object]')).toHaveCount(0);
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object] path')).toHaveCount(2);
});
