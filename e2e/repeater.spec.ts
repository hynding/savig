import { test, expect } from '@playwright/test';

// Same drag-drawn-rect gesture as style-tools.spec.ts / per-instance-overrides.spec.ts.
async function drawRect(page, x1: number, y1: number, x2: number, y2: number) {
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2);
  await page.mouse.up();
}

// NumberField only calls onCommit on blur/Enter, and only when the typed value differs from the
// field's current displayed value (Inspector.tsx: `if (n !== value) onCommit(n);`) — same commit
// gesture as animatable-primitives.spec.ts's Points field.
async function commitNumber(field, value: string) {
  await field.fill(value);
  await field.blur();
}

test('enabling repeat expands N copies with distinct wrapper transforms', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  await drawRect(page, 60, 60, 140, 120);
  const stageObjects = page.locator('section[aria-label="Stage"] [data-savig-object]');
  await expect(stageObjects).toHaveCount(1);
  await stageObjects.first().click();

  // Enable the repeater, then set copies=3 + repeat dx=40 (repeat.on defaults count=2/dx=0/
  // dy=0/rotate=0/scale=1/stagger=0 — toggleRepeat() writes those defaults, per store.ts).
  const repeatCheckbox = page.getByLabel('repeat', { exact: true });
  await expect(repeatCheckbox).not.toBeChecked();
  await repeatCheckbox.click();
  await expect(repeatCheckbox).toBeChecked();

  await commitNumber(page.getByLabel('copies', { exact: true }), '3');
  await commitNumber(page.getByLabel('repeat dx', { exact: true }), '40');

  // Exactly 3 Stage nodes: the source object plus its `@1`/`@2` copies (renderId = `<src>@k`,
  // per Stage.tsx's flattenInstances walker-seam expansion).
  await expect(stageObjects).toHaveCount(3);
  const entries = await stageObjects.evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute('data-savig-object'),
      transform: el.getAttribute('transform'),
    })),
  );
  const source = entries.find((e) => !e.id?.includes('@'));
  const copy1 = entries.find((e) => e.id?.endsWith('@1'));
  const copy2 = entries.find((e) => e.id?.endsWith('@2'));
  expect(source).toBeTruthy();
  expect(copy1).toBeTruthy();
  expect(copy2).toBeTruthy();
  expect(copy1!.id).toBe(`${source!.id}@1`);
  expect(copy2!.id).toBe(`${source!.id}@2`);

  // Each copy carries its own repeat-delta transform (translate(dx*k, 0), per repeat.ts's
  // repeatDeltaTransform), so all three wrapper transforms differ.
  expect(copy1!.transform).not.toBe(source!.transform);
  expect(copy2!.transform).not.toBe(source!.transform);
  expect(copy1!.transform).not.toBe(copy2!.transform);
});

test('stagger samples copies at different times; clicking a copy element selects its source', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  await drawRect(page, 60, 60, 140, 120);
  const stageObjects = page.locator('section[aria-label="Stage"] [data-savig-object]');
  await expect(stageObjects).toHaveCount(1);
  await stageObjects.first().click();

  // Auto-key is ON by default — leave it untouched (matches house style: animatable-primitives /
  // style-tools specs).
  await expect(page.getByRole('button', { name: 'Auto-key' })).toHaveAttribute('aria-pressed', 'true');

  // Keyframe `y` at t=0, move the playhead along the ruler, then keyframe `y` again — same
  // two-keyframe gesture as animatable-primitives.spec.ts's Points track.
  const yField = page.getByLabel('y', { exact: true });
  const y0 = Number(await yField.inputValue());
  await commitNumber(yField, String(y0 + 80)); // t=0 keyframe
  await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } }); // t=1.2s
  await commitNumber(yField, String(y0 - 80)); // second keyframe

  // Enable repeat: 3 copies, stagger 0.5s. dx/dy/rotate/scale are left at their identity
  // defaults so repeatDeltaTransform's static delta is '' for every copy (repeat.ts) — the ONLY
  // source of a transform difference between copies is the staggered sample TIME (engine's
  // flattenInstances: copy k samples at `max(0, time - k*stagger)`, per symbol.ts).
  const repeatCheckbox = page.getByLabel('repeat', { exact: true });
  await repeatCheckbox.click();
  await commitNumber(page.getByLabel('copies', { exact: true }), '3');
  await commitNumber(page.getByLabel('stagger', { exact: true }), '0.5');
  await expect(stageObjects).toHaveCount(3);

  // Scrub to a mid ruler position between the two y keyframes (t=0.6s): copy 0 (the source)
  // samples y at t=0.6, copy 1 samples at max(0, 0.6 - 0.5) = 0.1 — a different point on the
  // y interpolation, so their wrapper transforms diverge.
  await page.getByTestId('timeline-ruler').click({ position: { x: 60, y: 10 } });

  const sourceNode = page.locator(
    'section[aria-label="Stage"] [data-savig-object]:not([data-savig-object*="@"])',
  );
  const copy1 = page.locator('section[aria-label="Stage"] [data-savig-object$="@1"]');
  const copy2 = page.locator('section[aria-label="Stage"] [data-savig-object$="@2"]');
  await expect(sourceNode).toHaveCount(1);
  await expect(copy1).toHaveCount(1);
  await expect(copy2).toHaveCount(1);

  const sourceTransform = await sourceNode.getAttribute('transform');
  const copy1Transform = await copy1.getAttribute('transform');
  expect(copy1Transform).not.toBe(sourceTransform); // staggered sampling

  // Deselect first (click empty stage area, same gesture as nested-groups.spec.ts) so the
  // upcoming assertion actually proves the @2 click DOES the resolving, rather than the
  // source having stayed selected since the click at the top of the test.
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const svgBox = (await svg.boundingBox())!;
  await page.mouse.click(svgBox.x + svgBox.width - 20, svgBox.y + svgBox.height - 20);
  await expect(sourceNode).toHaveAttribute('data-selected', 'false');

  // Click copy @2's element -> selection resolves to the SOURCE object (Stage.tsx's
  // sourceObjectId strips the `@k` suffix before routing the pointerdown), not the
  // non-existent composite id "<src>@2".
  await copy2.click();

  // Every leaf of this source (itself + both copies) shares `data-selected = topId ===
  // selectedId` (Stage.tsx), so the SOURCE node now reads data-selected="true" — proof the
  // click resolved to the real object id, not the clicked copy's renderId.
  await expect(sourceNode).toHaveAttribute('data-selected', 'true');

  // The Inspector's Repeater section only renders for a resolved SceneObject (InspectorVM is
  // 'empty' for an unmatched selectedObjectId, per inspectorViewModel) — the repeat checkbox
  // being visible AND checked confirms selection landed on a real object with the repeat we
  // just enabled, i.e. the source.
  await expect(page.getByLabel('repeat', { exact: true })).toBeChecked();
});
