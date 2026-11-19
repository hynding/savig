import { test, expect } from '@playwright/test';

/** Editor animated-GIF export (roadmap 11): author a short animated project, open the dialog with
 *  the "Export GIF…" palette command, and check the saved bytes are a looping multi-frame GIF89a
 *  at the requested size. Real canvas rasterization + gifenc encode in the browser. */
test('Export GIF… saves a looping animated GIF', async ({ page }) => {
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

  // A rect in scene 1, then an empty scene 2.
  const stage = page.locator('section[aria-label="Stage"]');
  const tools = page.getByRole('group', { name: 'Tools' });
  const box = (await stage.locator('svg').first().boundingBox())!;
  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 100);
  await page.mouse.up();
  await tools.getByRole('button', { name: 'Select', exact: true }).click();
  // Two 0.5s scenes give the project a 1s duration (8 frames at 8 fps), crossing a scene cut.
  await page.getByRole('button', { name: 'Add scene' }).click();
  await page.getByLabel('Scene duration').nth(0).fill('0.5');
  await page.getByLabel('Scene duration').nth(1).fill('0.5');
  await page.getByLabel('Scene duration').nth(1).press('Enter');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // shortcuts ignore text fields

  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await palette.getByLabel('Command search').fill('Export GIF');
  await palette.getByLabel('Command search').press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Export video' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Export GIF' })).toBeVisible();
  await expect(dialog.getByLabel('Format')).toHaveValue('gif');
  await expect(dialog.getByLabel('Loop forever')).toBeChecked();
  await dialog.getByLabel('Frames per second').fill('8');
  await dialog.getByLabel('Width').fill('160');
  const summary = (await dialog.getByTestId('export-video-summary').textContent())!;
  const expectedFrames = Number(/(\d+) frames/.exec(summary)![1]);
  expect(expectedFrames).toBe(8);
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();

  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __savedChunks: Uint8Array[] }).__savedChunks.length), { timeout: 60_000 })
    .toBeGreaterThan(0);
  await expect(dialog).not.toBeVisible();
  const bytes = Buffer.concat(
    (await page.evaluate(() => (window as unknown as { __savedChunks: Uint8Array[] }).__savedChunks.map((c) => Array.from(c)))).map((a) => Buffer.from(a)),
  );
  expect(bytes.subarray(0, 6).toString('ascii')).toBe('GIF89a');
  expect(bytes.readUInt16LE(6)).toBe(160); // logical screen width
  expect(bytes.includes(Buffer.from('NETSCAPE2.0', 'ascii'))).toBe(true); // loops
  let frames = 0;
  for (let i = 0; i + 2 < bytes.length; i++) if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) frames++;
  expect(frames).toBe(expectedFrames);
  expect(await page.evaluate(() => (window as unknown as { __savedName?: string }).__savedName)).toMatch(/\.gif$/);

  // The first frame actually shows the rect: decode it in the page and count non-white pixels.
  const inked = await page.evaluate(async (arr) => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(arr)], { type: 'image/gif' }));
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235) n++; // the default fill is #cccccc
    URL.revokeObjectURL(url);
    return n;
  }, Array.from(bytes));
  expect(inked).toBeGreaterThan(50);
});
