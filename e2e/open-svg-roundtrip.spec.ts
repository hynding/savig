/**
 * Round-trip open, real Chromium (Task 5): FileToolbar's aria-label="Open" button
 * (openProject() -> openBytesFromDisk('.savig,.svg')) accepts both an exported animated
 * SVG (embedded `<metadata data-savig-source="project">` -> full project) and a plain SVG
 * (wrapped as a new single-asset project, sanitizer keeps safe SMIL). Mirrors the
 * showSaveFilePicker-stub idiom from animated-svg-export.spec.ts / svg-export.spec.ts and the
 * app-boot + Stage/template-gallery idioms from getting-started.spec.ts / template-gallery.spec.ts.
 * ALWAYS scope Stage object queries to `section[aria-label="Stage"]` — the AssetPanel emits
 * `data-savig-object` too (the symbols.spec collision).
 */
import { expect, test } from '@playwright/test';

test('exported animated SVG reopens as the full editable project', async ({ page }) => {
  // Stub showSaveFilePicker to collect the written bytes into a window global instead of
  // hitting the (headless-hostile) native File System Access picker or a real download.
  await page.addInitScript(() => {
    const w = window as unknown as {
      __savedChunks?: Uint8Array[];
      showSaveFilePicker?: unknown;
      showOpenFilePicker?: unknown;
    };
    w.__savedChunks = [];
    w.showSaveFilePicker = async () => ({
      createWritable: async () => ({
        write: async (data: Uint8Array) => {
          w.__savedChunks!.push(data);
        },
        close: async () => {},
      }),
    });
    delete w.showOpenFilePicker;
  });
  await page.goto('/');

  // Load a template with animation ("Bouncing ball": one keyframed ellipse, id "ball").
  await page.getByRole('button', { name: 'New from template' }).click();
  const gallery = page.getByRole('dialog', { name: 'Template gallery' });
  await expect(gallery).toBeVisible();
  await gallery.getByText('Bouncing ball').click();
  await expect(gallery).toBeHidden();

  const stageObjects = page.locator('section[aria-label="Stage"] [data-savig-object]');
  await expect(stageObjects).toHaveCount(1);
  const idsBefore = await stageObjects.evaluateAll((els) => els.map((e) => e.getAttribute('data-savig-object')));

  // Export the animated SVG from the command palette (same idiom as animated-svg-export.spec.ts).
  await page.locator('section[aria-label="Stage"]').click();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByLabel('Command search').fill('export animated svg');
  await palette.getByLabel('Command search').press('Enter');
  await page.waitForFunction(() => (window as unknown as { __savedChunks: Uint8Array[] }).__savedChunks.length > 0);

  // Build a File from the captured bytes and stub showOpenFilePicker to hand it back.
  await page.evaluate(() => {
    const w = window as unknown as { __savedChunks: Uint8Array[]; showOpenFilePicker?: unknown };
    const total = w.__savedChunks.reduce((n, c) => n + c.length, 0);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of w.__savedChunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const file = new File([bytes], 'bouncing-ball.svg', { type: 'image/svg+xml' });
    w.showOpenFilePicker = async () => [{ getFile: async () => file }];
  });

  await page.getByRole('button', { name: 'Open' }).click();

  // Stage objects match the pre-export ids -> the full project (not a bare svg-asset) reopened.
  await expect(stageObjects).toHaveCount(1);
  const idsAfter = await stageObjects.evaluateAll((els) => els.map((e) => e.getAttribute('data-savig-object')));
  expect(idsAfter).toEqual(idsBefore);

  // The Layers panel shows the reopened object row.
  const layers = page.locator('section[aria-label="Layers"], [aria-label="Layers"]').first();
  await expect(layers.locator('[data-testid^="layer-"]')).toHaveCount(1);

  // Editability: selecting the object on the Stage shows the Inspector's position fields.
  await stageObjects.first().click();
  await expect(page.getByLabel('x', { exact: true })).toBeVisible();
});

test('plain SMIL SVG opens as a new project with a playing asset', async ({ page }) => {
  const smilSource =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="20" height="20">' +
    '<animate attributeName="x" values="0;80;0" dur="1s" repeatCount="indefinite"/></rect></svg>';

  await page.addInitScript((source) => {
    const file = new File([source], 'plain-smil.svg', { type: 'image/svg+xml' });
    (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = async () => [
      { getFile: async () => file },
    ];
  }, smilSource);
  await page.goto('/');

  await page.getByRole('button', { name: 'Open' }).click();

  await expect(page.locator('section[aria-label="Stage"] [data-savig-object]')).toHaveCount(1);
  // View-only playback retained through the sanitizer: the inlined asset def keeps <animate>.
  expect(await page.locator('section[aria-label="Stage"] animate').count()).toBeGreaterThan(0);
});
