import { test, expect } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

/** Sprite-sheet export (roadmap 11): two 0.5s scenes at 8 fps -> 8 frames; a 4-column sheet of
 *  64px cells is saved as a zip of <name>.png + <name>.json whose atlas matches the PNG size and
 *  whose first cell shows the rect. Real canvas rasterization in the browser. */
test('Export Sprite Sheet… saves a PNG atlas and its JSON', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __savedChunks?: Uint8Array[]; __savedName?: string; showSaveFilePicker?: unknown };
    w.__savedChunks = [];
    w.showSaveFilePicker = async (o: { suggestedName?: string }) => {
      w.__savedName = o?.suggestedName;
      return {
        createWritable: async () => ({
          write: async (chunk: Uint8Array) => void w.__savedChunks!.push(chunk),
          close: async () => {},
        }),
      };
    };
  });
  await page.goto('/');

  const stage = page.locator('section[aria-label="Stage"]');
  const tools = page.getByRole('group', { name: 'Tools' });
  const box = (await stage.locator('svg').first().boundingBox())!;
  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 160);
  await page.mouse.up();
  await tools.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: 'Add scene' }).click();
  await page.getByLabel('Scene duration').nth(0).fill('0.5');
  await page.getByLabel('Scene duration').nth(1).fill('0.5');
  await page.getByLabel('Scene duration').nth(1).press('Enter');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await palette.getByLabel('Command search').fill('Export Sprite Sheet');
  await palette.getByLabel('Command search').press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Export video' });
  await expect(dialog.getByRole('heading', { name: 'Export Sprite Sheet' })).toBeVisible();
  await expect(dialog.getByLabel('Format')).toHaveValue('sprites');
  await dialog.getByLabel('Frames per second').fill('8');
  await dialog.getByLabel('Width').fill('64');
  await dialog.getByLabel('Columns').fill('4');
  await expect(dialog.getByTestId('export-video-summary')).toContainText('8 frames · 4×2 grid');
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();

  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __savedChunks: Uint8Array[] }).__savedChunks.length), { timeout: 60_000 })
    .toBeGreaterThan(0);
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __savedName?: string }).__savedName)).toMatch(/-spritesheet\.zip$/);
  const bytes = Buffer.concat(
    (await page.evaluate(() => (window as unknown as { __savedChunks: Uint8Array[] }).__savedChunks.map((c) => Array.from(c)))).map((a) => Buffer.from(a)),
  );
  const files = unzipSync(new Uint8Array(bytes));
  const pngName = Object.keys(files).find((n) => n.endsWith('.png'))!;
  const jsonName = Object.keys(files).find((n) => n.endsWith('.json'))!;
  expect(pngName.replace(/\.png$/, '')).toBe(jsonName.replace(/\.json$/, ''));
  const png = Buffer.from(files[pngName]);
  expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  const atlas = JSON.parse(strFromU8(files[jsonName]));
  expect(Object.keys(atlas.frames)).toHaveLength(8);
  expect(atlas.meta.image).toBe(pngName);
  // IHDR width/height (big-endian at bytes 16..23) match the atlas size: 4 x 64 by 2 rows.
  expect(png.readUInt32BE(16)).toBe(atlas.meta.size.w);
  expect(png.readUInt32BE(20)).toBe(atlas.meta.size.h);
  expect(atlas.meta.size.w).toBe(256);

  // Transparent by default, and the first cell shows the rect: decode in the page and look.
  const { transparent, inked } = await page.evaluate(async ({ arr, cell }) => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(arr)], { type: 'image/png' }));
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(cell.x, cell.y, cell.w, cell.h).data;
    let t = 0;
    let k = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) t++;
      else if (d[i] < 235) k++;
    }
    URL.revokeObjectURL(url);
    return { transparent: t, inked: k };
  }, { arr: Array.from(png), cell: Object.values(atlas.frames as Record<string, { frame: { x: number; y: number; w: number; h: number } }>)[0].frame });
  expect(inked).toBeGreaterThan(20);
  expect(transparent).toBeGreaterThan(20);
});
