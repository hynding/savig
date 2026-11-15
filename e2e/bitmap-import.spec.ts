// Bitmap import slice 2 (spec 2026-11-15-bitmap-import): import an image from the Asset panel or by
// dropping a file on the Stage, mark it a guide, and confirm the export leaves the guide out.
import { test, expect, type Page } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';

const RED_2X2 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==',
  'base64',
);

async function exportedIndexHtml(page: Page): Promise<string> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  const chunks: Buffer[] = [];
  for await (const c of await download.createReadStream()) chunks.push(c as Buffer);
  return strFromU8(unzipSync(new Uint8Array(Buffer.concat(chunks)))['index.html']);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');
});

test('Import Image places the bitmap; marking it a guide keeps it in the editor but out of the export', async ({ page }) => {
  await page.getByLabel('Import Image').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: RED_2X2 });

  // One library row, one placed object drawn through the shared asset def.
  await expect(page.getByRole('button', { name: '🖼 red', exact: true })).toBeVisible();
  const def = page.locator('svg[id^="savig-asset-img-"] image');
  await expect(def).toHaveCount(1);
  expect(await def.getAttribute('href')).toMatch(/^data:image\/png;base64,/);
  const node = page.locator('use[data-savig-object]');
  await expect(node).toHaveCount(1);
  await expect(page.getByTestId('inspector-image')).toContainText('2 × 2 px');

  // Exported with the image while it is an ordinary object.
  expect(await exportedIndexHtml(page)).toContain('data:image/png;base64,');

  // Guide: badge in Layers, still on the Stage, gone from the export.
  await page.getByLabel('Guide', { exact: true }).check();
  const id = await node.getAttribute('data-savig-object');
  await expect(page.getByTestId(`guide-badge-${id}`)).toBeVisible();
  await expect(node).toHaveCount(1);
  const html = await exportedIndexHtml(page);
  expect(html).not.toContain(`data-savig-object="${id}"`);
  expect(html).not.toContain('<image');

  // Undo clears the guide again.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect(page.getByTestId(`guide-badge-${id}`)).toHaveCount(0);
});

test('dropping an image file on the Stage imports it centred on the drop point', async ({ page }) => {
  const stage = page.getByTestId('stage-frame');
  const box = (await stage.boundingBox())!;
  await page.evaluate(
    async ({ b64, x, y }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'dot.png', { type: 'image/png' }));
      const target = document.elementFromPoint(x, y)!;
      for (const type of ['dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
      }
    },
    { b64: RED_2X2.toString('base64'), x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  await expect(page.locator('use[data-savig-object]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '🖼 dot', exact: true })).toBeVisible();
  const placed = (await page.locator('use[data-savig-object]').boundingBox())!;
  expect(Math.abs(placed.x + placed.width / 2 - (box.x + box.width / 2))).toBeLessThan(3);
  expect(Math.abs(placed.y + placed.height / 2 - (box.y + box.height / 2))).toBeLessThan(3);

  // A non-image drop is refused with a message.
  await page.evaluate(({ x, y }) => {
    const dt = new DataTransfer();
    dt.items.add(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    document.elementFromPoint(x, y)!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await expect(page.getByText('"notes.txt" is not a PNG, JPEG, GIF or WebP image.')).toBeVisible();
  await expect(page.locator('use[data-savig-object]')).toHaveCount(1);
});
