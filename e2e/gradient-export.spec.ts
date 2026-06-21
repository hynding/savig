import { test, expect } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';

test('a linear gradient fill exports as a <linearGradient> def referenced by the shape', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rectangle.
  await page.getByRole('button', { name: 'Rectangle' }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 170);
  await page.mouse.up();

  // Assign a linear gradient to the fill via the Inspector paint-type control.
  await page.getByLabel('fill paint').selectOption('linear');

  // The Stage immediately previews the gradient via url(#…).
  const stageShape = page.locator('[data-savig-object] rect').first();
  await expect(stageShape).toHaveAttribute('fill', /url\(#savig-grad-[^)]+-fill\)/);

  // Export and capture the bundle.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const c of stream as NodeJS.ReadableStream) chunks.push(c as Buffer);
  const files = unzipSync(new Uint8Array(Buffer.concat(chunks)));
  expect(Object.keys(files)).toContain('index.html');

  const html = strFromU8(files['index.html']);
  expect(html).toContain('<linearGradient id="savig-grad-');
  expect(html).toMatch(/fill="url\(#savig-grad-[^"]+-fill\)"/);
});
