import { test, expect } from '@playwright/test';

// Blend (art-tools #9, task 4): Illustrator-style blend between the exactly-2 selected vector
// paths. Eligibility requires shapeType 'path' (store-internals.ts isBlendEligible) — RECT-TOOL
// shapes are shapeType 'rect' and are INELIGIBLE (unlike shape-builder.spec.ts's rects), so both
// blend sources here are drawn with the Line tool (outline-stroke.spec.ts / text-on-path.spec.ts
// precedent: the Line tool commits a 2-node open vector path via addVectorPath — shapeType
// 'path' — and auto-selects the new object).
//
// Two short diagonal lines (NOT perfectly horizontal/vertical — a perfectly axis-aligned line's
// getBoundingClientRect() has a zero-width or zero-height box in Chromium, which Playwright's
// actionability check treats as "not visible" and click() then times out waiting for it; a slight
// diagonal keeps a real 2D bbox whose CENTER still lands exactly on the line, since a straight
// segment's own midpoint always coincides with its bbox center), well separated in y, same
// x-range/shape so blend correspondence is a trivial per-node lerp (equal node counts ->
// 'corresponded' reconcile, engine/src/blend.ts):
//   A: (80,80)->(240,110)    (drawn first -> zOrder 0, the LOWER-zOrder operand = blend's "A")
//   B: (80,300)->(240,330)   (drawn second -> zOrder 1, blend's "B" endpoint)
// blendSelected's direction follows stacking, not selection click order (store.ts comment), so A
// is always the low-zOrder line regardless of click order below. New objects get zOrder
// nextZOrder()+i (ascending) and symbol.ts's flatten sort renders by ascending zOrder, so DOM
// order after the blend is [A, B, Blend1, Blend2, Blend3] — index 3 is the middle intermediate
// ("Blend 2", t = 2/(3+1) = 0.5 under the Inspector's default linear easing).

test('Blend: two selected paths generate intermediates, undo restores the pair', async ({ page }) => {
  await page.goto('/');

  const stage = page.locator('section[aria-label="Stage"]');
  const svg = stage.locator('svg').first();
  const box = (await svg.boundingBox())!;
  const objects = stage.locator('[data-savig-object]');

  // The Line tool's commit action auto-switches activeTool to 'node' (store.ts, the
  // scissors.spec.ts precedent) so the just-drawn path can be node-edited immediately — clicking
  // back to Select afterwards (draw-path.spec.ts's Pen precedent) is required before a plain
  // object click will hit the normal select-and-multiselect path.
  const drawLine = async (x0: number, y0: number, x1: number, y1: number) => {
    await page.getByRole('button', { name: 'Line', exact: true }).click();
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.up();
    await page.getByRole('button', { name: 'Select', exact: true }).click();
  };

  await drawLine(80, 80, 240, 110); // A
  await expect(objects).toHaveCount(1);

  // Negative affordance: with a single object selected (the Line tool auto-selects A), the
  // whole blend row is absent — Inspector.tsx only renders it when vm.kind === 'multi' with
  // count === 2, a branch a single selection never reaches.
  await expect(page.getByLabel('blend steps')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Blend', exact: true })).toHaveCount(0);

  await drawLine(80, 300, 240, 330); // B
  await expect(objects).toHaveCount(2);

  // Multi-select both (shape-builder.spec.ts precedent): the Line tool auto-selects only the
  // just-drawn object (B), so click A then shift-click B to build a 2-object selection.
  await objects.nth(0).click();
  await objects.nth(1).click({ modifiers: ['Shift'] });
  await expect(page.getByText(/2 objects selected/i)).toBeVisible();

  const stepsField = page.getByLabel('blend steps', { exact: true });
  await expect(stepsField).toBeVisible();
  await stepsField.fill('3');
  const easingField = page.getByLabel('blend easing', { exact: true });
  await expect(easingField).toHaveValue('linear');

  const boxA = (await objects.nth(0).boundingBox())!;
  const boxB = (await objects.nth(1).boundingBox())!;
  const dA = await objects.nth(0).locator('path').getAttribute('d');
  const dB = await objects.nth(1).locator('path').getAttribute('d');
  const transformA = await objects.nth(0).getAttribute('transform');
  const transformB = await objects.nth(1).getAttribute('transform');

  await page.getByRole('button', { name: 'Blend', exact: true }).click();

  // 2 sources + 3 intermediates.
  await expect(objects).toHaveCount(5);

  // The middle intermediate ("Blend 2"): A and B are CONGRUENT (same shape, translated), so a
  // lerp between them re-normalizes to the SAME local `d` at every step — the actual, meaningful
  // difference is positional. Its `transform` (the world placement) differs from both sources,
  // and it renders vertically BETWEEN the two source lines (a real spatial interpolation, not a
  // coincidental stack-on-top placement).
  const mid = objects.nth(3);
  const boxMid = (await mid.boundingBox())!;
  const transformMid = await mid.getAttribute('transform');

  expect(transformMid).not.toBe(transformA);
  expect(transformMid).not.toBe(transformB);
  const yLo = Math.min(boxA.y, boxB.y);
  const yHi = Math.max(boxA.y, boxB.y);
  expect(boxMid.y).toBeGreaterThan(yLo + 5);
  expect(boxMid.y).toBeLessThan(yHi - 5);

  // Undo the single blend commit -> back to the original 2 objects, geometry unchanged.
  await page.keyboard.press('ControlOrMeta+KeyZ');
  await expect(objects).toHaveCount(2);
  expect(await objects.nth(0).locator('path').getAttribute('d')).toBe(dA);
  expect(await objects.nth(1).locator('path').getAttribute('d')).toBe(dB);
});

test('Blend: locking a source drops it from the selection, hiding the blend row', async ({ page }) => {
  await page.goto('/');

  const stage = page.locator('section[aria-label="Stage"]');
  const svg = stage.locator('svg').first();
  const box = (await svg.boundingBox())!;
  const objects = stage.locator('[data-savig-object]');

  const drawLine = async (x0: number, y0: number, x1: number, y1: number) => {
    await page.getByRole('button', { name: 'Line', exact: true }).click();
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.up();
    await page.getByRole('button', { name: 'Select', exact: true }).click();
  };

  await drawLine(80, 80, 240, 110); // A
  await drawLine(80, 300, 240, 330); // B
  await expect(objects).toHaveCount(2);

  await objects.nth(0).click();
  await objects.nth(1).click({ modifiers: ['Shift'] });
  await expect(page.getByText(/2 objects selected/i)).toBeVisible();

  const blendButton = page.getByRole('button', { name: 'Blend', exact: true });
  await expect(blendButton).toBeEnabled();

  // Lock one of the two sources via the Layers panel (lock-object.spec.ts precedent). Pinning
  // the ACTUAL behavior (store.ts toggleObjectLock): locking unconditionally drops the
  // freshly-locked id from selectedObjectIds ("a freshly-locked object... can't be
  // edited/deleted"), so a 2-object selection collapses to 1 — the Inspector's vm.kind falls
  // from 'multi' to a single-object panel and the count===2-gated blend row (steps input +
  // easing select + Blend button) disappears entirely, rather than staying mounted-but-disabled.
  const row = page.locator('section[aria-label="Assets"] [data-testid^="layer-"]').first();
  const rowId = (await row.getAttribute('data-testid'))!.replace('layer-', '');
  await page.getByTestId(`lock-${rowId}`).click();

  await expect(page.getByText(/2 objects selected/i)).toHaveCount(0);
  await expect(page.getByLabel('blend steps')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Blend', exact: true })).toHaveCount(0);

  // The locked object is also non-interactive on the stage (lock-object.spec.ts): clicking it
  // does not rebuild a 2-object selection, so the blend row stays gone.
  await stage.locator(`[data-savig-object="${rowId}"]`).click({ modifiers: ['Shift'] });
  await expect(page.getByText(/2 objects selected/i)).toHaveCount(0);
  await expect(objects).toHaveCount(2); // nothing was blended
});
