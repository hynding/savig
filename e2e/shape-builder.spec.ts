import { test, expect } from '@playwright/test';

// Two overlapping rects (art-tools #7 shape builder):
//   A: (60,60) -> (160,140)   B bbox: (120,60) -> (220,140)
// Overlap band: x 120-160, y 60-140 -> a 40x80 region centered at (140, 100).
// A-only / B-only are each 60x80=4800 (STRICTLY bigger than the 40x80=3200 overlap), so
// decomposeRegions' descending-area sort deterministically puts the overlap LAST regardless of
// tie-break behavior between the two equal-area singleton regions — we locate it by its
// `data-contributors` attribute (two ids, comma-joined) rather than assuming an index.
//
// B is drawn REVERSED (press at 220,140 -> drag to 120,60, same bbox as 120,60->220,140):
// `onObjectPointerDown` has no draw-tool early-exit, so a press that LANDS on an already-drawn
// object (rect A covers x 60-160) selects/would-move it instead of arming a new draw. Starting
// the press on empty canvas and dragging INTO the overlap avoids that — window-level
// pointermove/pointerup listeners (Stage.tsx) keep tracking the draft rect regardless of what's
// under the cursor mid-drag, so the final bbox is unaffected by drag direction.

test('Shape Builder: merge the overlap region, undo, then punch it, undo', async ({ page }) => {
  await page.goto('/');

  const stage = page.locator('section[aria-label="Stage"]');
  const svg = stage.locator('svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });

  const drawRect = async (x0: number, y0: number, x1: number, y1: number) => {
    await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.up();
  };

  await drawRect(60, 60, 160, 140); // A
  await drawRect(220, 140, 120, 60); // B (reversed: press empty, drag into A's bbox)

  const objects = stage.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2);

  // Multi-select both: click A in a corner clear of the overlap (local top-left, mirrors the
  // boolean-ops.spec.ts precedent), then shift-click B in a corner clear of the overlap (its
  // local bottom-right — overlap only reaches local x<=40 within B's 100x80 box).
  await objects.nth(0).click({ position: { x: 10, y: 10 } });
  await objects.nth(1).click({ modifiers: ['Shift'], position: { x: 90, y: 70 } });
  await expect(page.getByText(/2 objects selected/i)).toBeVisible();

  const shapeBuilderBtn = page.getByRole('button', { name: 'Shape builder', exact: true });
  const hint = page.getByTestId('sb-hint');
  const regions = stage.locator('[data-testid^="sb-region-"]');
  const overlapRegion = stage.locator('[data-testid^="sb-region-"][data-contributors*=","]');

  await shapeBuilderBtn.click();
  await expect(hint).toBeVisible();
  // Two overlapping rects decompose into 3 atomic regions: A-only, B-only, A∩B.
  await expect(regions).toHaveCount(3);
  await expect(overlapRegion).toHaveCount(1);

  // Click the overlap region at its stage-space center, derived from the two drags above.
  await page.mouse.click(box.x + 140, box.y + 100);

  // Merge: the two contributors collapse into one union object; only 2 frozen ids fed the merge,
  // so shapeBuilderMerge's auto-exit fires immediately (fewer than 2 ids remain) -- the mode
  // exits on its own, no Escape needed.
  await expect(objects).toHaveCount(1);
  await expect(hint).not.toBeVisible();
  await expect(regions).toHaveCount(0);

  // Undo the merge commit -> back to two objects. shapeBuilder is a TRANSIENT store field (not
  // part of undo history) and it was already cleared to null by the merge's own auto-exit BEFORE
  // this undo ran, so undo has nothing mode-related to restore: the mode stays INACTIVE (pin —
  // don't assert re-entry that never happens).
  await page.keyboard.press('ControlOrMeta+KeyZ');
  await expect(objects).toHaveCount(2);
  await expect(hint).not.toBeVisible();

  // Traced: shapeBuilderMerge deliberately leaves the LIVE selection (`selectedObjectIds`)
  // untouched ("selection is left alone during the mode") -- it stays [A,B] all the way through
  // the merge, even though A/B briefly stop existing (replaced by the merged object). `undo()`
  // reconciles it via `clearStaleSelection`, which filters the (unchanged) [A,B] against the
  // restored project -- and since undo brings back the ORIGINAL A/B ids, both survive the
  // filter. So both are, in fact, ALREADY selected again post-undo (pinned below).
  await expect(page.getByText(/2 objects selected/i)).toBeVisible();

  // Pre-punch, both objects are still PRIMITIVE rects (shapeType 'rect' -> a real SVG <rect>,
  // per Stage.tsx's `ShapeTag = asset.shapeType === 'rect' ? 'rect' : 'ellipse'` branch — there
  // is no `d`/<path> yet). Capture their box geometry (order is stable across merge/undo/punch
  // -- no reordering occurs) as the pre-punch baseline.
  const rectAttrs = async (i: number) => {
    const r = objects.nth(i).locator('rect').first();
    return Promise.all(['x', 'y', 'width', 'height'].map((a) => r.getAttribute(a)));
  };
  await expect(stage.locator('[data-savig-object] rect')).toHaveCount(2);
  const rectA_before = await rectAttrs(0);
  const rectB_before = await rectAttrs(1);

  // Re-select both via a FRESH, deterministic gesture: click empty canvas first to clear
  // whatever undo left selected (a shift-click on an object already IN a multi-selection
  // TOGGLES it OFF, so blindly repeating click+shift-click on top of the surviving [A,B]
  // selection would deselect B instead of confirming it) -- then click A, shift-click B.
  await page.mouse.click(box.x + 350, box.y + 300); // empty canvas, clear of both rects
  await objects.nth(0).click({ position: { x: 10, y: 10 } });
  await objects.nth(1).click({ modifiers: ['Shift'], position: { x: 90, y: 70 } });
  await expect(page.getByText(/2 objects selected/i)).toBeVisible();
  await shapeBuilderBtn.click();
  await expect(hint).toBeVisible();
  await expect(regions).toHaveCount(3);

  // Alt-click the overlap region: punches it out of EACH contributor (per-contributor
  // difference) rather than merging -- both objects remain, but each is primitive-detached: the
  // difference result writes back as `path`/`compoundRings` (spec decision 5), so the punched
  // objects turn into <path> elements with a `d` -- a stronger signal than a `d` diff would be,
  // since it proves the geometry left primitive-rect form entirely.
  // `page.mouse.click` has no `modifiers` option (unlike `locator.click`) -- hold Alt via the
  // keyboard around a plain mouse click instead.
  await page.keyboard.down('Alt');
  await page.mouse.click(box.x + 140, box.y + 100);
  await page.keyboard.up('Alt');

  await expect(objects).toHaveCount(2);
  await expect(stage.locator('[data-savig-object] rect')).toHaveCount(0);
  const paths = stage.locator('[data-savig-object] path');
  await expect(paths).toHaveCount(2);
  await expect(paths.nth(0)).toHaveAttribute('d', /.+/);
  await expect(paths.nth(1)).toHaveAttribute('d', /.+/);

  // Undo the punch commit -> both objects revert to their original primitive rects.
  await page.keyboard.press('ControlOrMeta+KeyZ');
  await expect(objects).toHaveCount(2);
  await expect(stage.locator('[data-savig-object] rect')).toHaveCount(2);
  expect(await rectAttrs(0)).toEqual(rectA_before);
  expect(await rectAttrs(1)).toEqual(rectB_before);
});

test('Shape Builder: Escape exits the mode, objects stay intact', async ({ page }) => {
  await page.goto('/');

  const stage = page.locator('section[aria-label="Stage"]');
  const svg = stage.locator('svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });

  const drawRect = async (x0: number, y0: number, x1: number, y1: number) => {
    await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.up();
  };

  await drawRect(60, 60, 160, 140);
  await drawRect(220, 140, 120, 60); // B (reversed: press empty, drag into A's bbox)

  const objects = stage.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2);

  await objects.nth(0).click({ position: { x: 10, y: 10 } });
  await objects.nth(1).click({ modifiers: ['Shift'], position: { x: 90, y: 70 } });
  await expect(page.getByText(/2 objects selected/i)).toBeVisible();

  const hint = page.getByTestId('sb-hint');
  await page.getByRole('button', { name: 'Shape builder', exact: true }).click();
  await expect(hint).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(hint).not.toBeVisible();
  await expect(stage.locator('[data-testid^="sb-region-"]')).toHaveCount(0);
  // Nothing was merged/punched -- both objects, untouched.
  await expect(objects).toHaveCount(2);
});
