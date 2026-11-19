/**
 * Button symbols (spec 2026-11-19-button-symbols), real Chromium, authored through the real UI:
 * draw a face and a glow, make them a symbol, tick "button", set the glow to Over only, then check
 * the Over/Down states in the editor preview and in the exported HTML bundle.
 */
import { test, expect, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

async function authorButton(page: Page) {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');
  const stage = page.locator('section[aria-label="Stage"]');
  const box = (await stage.locator('svg').first().boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });
  const drawRect = async (x0: number, y0: number, x1: number, y1: number) => {
    await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.up();
  };
  await drawRect(120, 100, 260, 180); // face
  await drawRect(300, 100, 380, 180); // glow, beside the face
  const objects = stage.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2);
  const glowId = await objects.nth(1).getAttribute('data-savig-object');
  await tools.getByRole('button', { name: 'Select' }).click();
  await objects.nth(0).click();
  await objects.nth(1).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();

  const composite = stage.locator('[data-savig-object*="/"]');
  await composite.first().click();
  await page.getByTestId('symbol-button').check();

  // Inside the button: the glow shows only in Over.
  await composite.last().dblclick();
  await expect(page.getByTestId('edit-breadcrumb')).toBeVisible();
  await stage.locator(`[data-savig-object="${glowId}"]`).click();
  await page.getByTestId('button-state-up').uncheck();
  await page.getByTestId('button-state-down').uncheck();
  await page.getByTestId('edit-breadcrumb').getByRole('button', { name: 'Root' }).click();
  await expect(page.getByTestId('edit-breadcrumb')).toHaveCount(0);

  const instId = (await composite.first().getAttribute('data-savig-object'))!.split('/')[0];
  return { stage, box, face: `${instId}/${(await composite.first().getAttribute('data-savig-object'))!.split('/')[1]}`, glow: `${instId}/${glowId}` };
}

test('a button shows its Over state on hover in the editor preview', async ({ page }) => {
  const { stage, box, face, glow } = await authorButton(page);
  const glowEl = stage.locator(`[data-savig-object="${glow}"]`);
  await expect(glowEl).toHaveAttribute('visibility', 'hidden'); // Up state at rest

  await page.getByTestId('preview-toggle').click();
  await stage.locator(`[data-savig-object="${face}"]`).hover({ force: true });
  await expect(glowEl).toHaveAttribute('visibility', 'visible');
  await page.mouse.move(box.x + 400, box.y + 350); // leave the button
  await expect(glowEl).toHaveAttribute('visibility', 'hidden');
});

test('the exported bundle switches the button to Over on hover', async ({ page }) => {
  const { face, glow } = await authorButton(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  const chunks: Buffer[] = [];
  for await (const c of (await download.createReadStream()) as NodeJS.ReadableStream) chunks.push(c as Buffer);
  const dir = mkdtempSync(join(tmpdir(), 'savig-button-'));
  for (const [p, data] of Object.entries(unzipSync(new Uint8Array(Buffer.concat(chunks))))) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), data);
  }
  const exported = await page.context().newPage();
  await exported.goto(pathToFileURL(join(dir, 'index.html')).href);
  const glowEl = exported.locator(`[data-savig-object$="${glow}"]`);
  await expect(glowEl).toHaveAttribute('visibility', 'hidden');
  const faceEl = exported.locator(`[data-savig-object$="${face}"]`);
  await expect(faceEl).toHaveCSS('cursor', 'pointer');
  await faceEl.hover({ force: true });
  await expect(glowEl).toHaveAttribute('visibility', 'visible');
});
