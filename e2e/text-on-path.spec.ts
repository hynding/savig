import { test, expect } from '@playwright/test';

// A framework-neutral fixture (portable-render.spec.ts precedent) seeding ONE text object at
// project load: the editor has no toolbar/command-palette flow to CREATE a text object (the M5
// text slice only shipped Inspector editing for an existing one — confirmed by grepping
// ToolPalette.tsx and ui-core's COMMANDS registry, neither lists a text tool/command). So the
// text object is loaded via window.savigLoadProject (the same sanctioned editor test hook
// portable-render.spec.ts uses), and the Line (the path target) is drawn for real through the
// Line tool — proving the draw -> attach flow works against a genuinely-drawn path. The text's
// base position (100, 220) is well clear of the line's y~80 band so later clicks-to-select never
// hit the wrong element.
const FIXTURE = {
  meta: { name: 'Untitled', width: 1280, height: 720, fps: 30, duration: 0, durationMode: 'auto', loop: false, version: 5 },
  assets: [{ id: 'text-asset', kind: 'text', name: 'Text', content: 'Hello', fontSize: 48, fill: '#000000' }],
  objects: [
    {
      id: 'text-obj',
      name: 'Text',
      assetId: 'text-asset',
      zOrder: 0,
      anchorX: 0,
      anchorY: 0,
      base: { x: 100, y: 220, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      tracks: {},
    },
  ],
  audioClips: [],
};

test('text-on-path: draw a Line, attach text, animate offset, detach', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  await page.waitForFunction(
    () => typeof (window as unknown as { savigLoadProject?: unknown }).savigLoadProject === 'function',
  );
  await page.evaluate((p) => (window as unknown as { savigLoadProject: (x: unknown) => void }).savigLoadProject(p), FIXTURE);
  await page.waitForSelector('[data-savig-object="text-obj"]');

  const stage = page.locator('section[aria-label="Stage"]');

  // Draw a Line (a real path object, shapeType 'path' — the only eligible attach target) via the
  // Line tool, away from the text's clickable region.
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  const svg = stage.locator('svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + 80);
  await page.mouse.up();

  const stageObjects = stage.locator('[data-savig-object]');
  await expect(stageObjects).toHaveCount(2); // the seeded text + the just-drawn line

  // The Line tool auto-selects its new object (outline-stroke.spec.ts precedent) — capture its id.
  const lineId = await stage.locator('[data-savig-object][data-selected="true"]').getAttribute('data-savig-object');
  expect(lineId).toBeTruthy();

  // Select the text object.
  await stage.locator('[data-savig-object="text-obj"]').click();

  // Attach to path: the select lists the line as an eligible target.
  const attachSelect = page.getByLabel('attach to path', { exact: true });
  await expect(attachSelect.locator(`option[value="${lineId}"]`)).toHaveCount(1);
  await attachSelect.selectOption(lineId!);

  // The Stage text now contains a <textPath> whose href resolves to a def IN THE DOCUMENT.
  const textEl = stage.locator('[data-savig-object="text-obj"] text');
  const textPathEl = textEl.locator('textPath');
  await expect(textPathEl).toHaveCount(1);
  const href = await textPathEl.getAttribute('href');
  expect(href).toMatch(/^#savig-textpath-/);
  // Scoped to the Stage: the Timeline's scene-strip thumbnail re-renders the same content (and
  // so the same id) in a separate mini SVG — scoping avoids a duplicate-id false negative.
  const def = stage.locator(href!);
  await expect(def).toHaveCount(1);
  await expect(def).toHaveAttribute('d', /.+/); // the def resolves to real path geometry

  // Animate the offset: autoKey is ON by default. Set 0.1 at t=0, advance the playhead via the
  // ruler (~120px), set 0.6 there.
  const offsetField = page.getByLabel('path offset', { exact: true });
  await page.getByTestId('timeline-ruler').click({ position: { x: 0, y: 10 } });
  await offsetField.fill('0.1');
  await offsetField.blur();
  await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } });
  await offsetField.fill('0.6');
  await offsetField.blur();

  // Scrub between the two positions: startOffset differs.
  await page.getByTestId('timeline-ruler').click({ position: { x: 0, y: 10 } });
  const startOffsetAtZero = await textPathEl.getAttribute('startOffset');
  await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } });
  await expect(textPathEl).not.toHaveAttribute('startOffset', startOffsetAtZero ?? '');

  // Detach: back to a plain <text> (no <textPath>); the def is gone (no longer referenced).
  await page.getByRole('button', { name: 'detach from path', exact: true }).click();
  await expect(textEl.locator('textPath')).toHaveCount(0);
  await expect(stage.locator(href!)).toHaveCount(0);
  await expect(textEl).toHaveCount(1);
});
