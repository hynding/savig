import { test, expect } from '@playwright/test';

test('text tool: click-to-place, edit content, bind to a drawn path (reachability)', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const stage = page.locator('section[aria-label="Stage"]');
  const svg = stage.locator('svg').first();

  // Select the Text tool and click once inside the artboard (no drag) — click-to-place.
  await page.getByRole('button', { name: 'Text' }).click();
  const box = (await svg.boundingBox())!;
  await page.mouse.click(box.x + 200, box.y + 200);

  // A text object now renders on the Stage...
  const stageText = stage.locator('[data-savig-object] text');
  await expect(stageText).toHaveCount(1);
  await expect(stageText).toHaveText('Text'); // createTextAsset's default content

  // ...it's selected (the Inspector's Text panel content field is visible)...
  const contentField = page.getByLabel('text content', { exact: true });
  await expect(contentField).toBeVisible();
  await expect(contentField).toHaveValue('Text');

  // ...and the tool reverted to Select (one-shot click-to-place, addTextObject precedent).
  await expect(page.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true');

  // Edit content: commits on BLUR, not per-keystroke.
  await contentField.fill('Hello Savig');
  await contentField.blur();
  await expect(stageText).toHaveText('Hello Savig');

  // Reachability proof: draw a real path (Line — shapeType 'path', the only eligible attach
  // target; a rect is ineligible) to bind the text to.
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await page.mouse.move(box.x + 400, box.y + 400);
  await page.mouse.down();
  await page.mouse.move(box.x + 600, box.y + 400);
  await page.mouse.up();

  const stageObjects = stage.locator('[data-savig-object]');
  await expect(stageObjects).toHaveCount(2); // the text + the just-drawn line

  // The Line tool auto-selects its new object (text-on-path.spec precedent) — capture its id.
  const lineId = await stage.locator('[data-savig-object][data-selected="true"]').getAttribute('data-savig-object');
  expect(lineId).toBeTruthy();

  // Re-select the text object by clicking its glyphs on the Stage.
  await stageText.click();
  await expect(contentField).toBeVisible();

  // Attach to path: the select lists the drawn line as an eligible target.
  const attachSelect = page.getByLabel('attach to path', { exact: true });
  await expect(attachSelect.locator(`option[value="${lineId}"]`)).toHaveCount(1);
  await attachSelect.selectOption(lineId!);

  // The Stage text now contains a <textPath> whose href resolves to a def in the document —
  // proof of the full chain: tool-created text -> bindable via the existing text-on-path UI.
  const textPathEl = stageText.locator('textPath');
  await expect(textPathEl).toHaveCount(1);
  const href = await textPathEl.getAttribute('href');
  expect(href).toMatch(/^#savig-textpath-/);
  const def = stage.locator(href!);
  await expect(def).toHaveCount(1);
  await expect(def).toHaveAttribute('d', /.+/);
});
