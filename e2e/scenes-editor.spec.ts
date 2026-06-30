import { test, expect } from '@playwright/test';

/**
 * Multi-scene editor e2e (8b-3): proves that object edits route to the
 * selected scene and that switching scenes correctly isolates Stage content.
 *
 * CRITICAL: SceneStrip thumbnails render via renderSvgDocument, which emits
 * [data-savig-object] elements — the same attribute Stage objects use.
 * ALL object-count assertions are scoped to `section[aria-label="Stage"]`
 * to avoid counting thumbnail contents (see M4 lesson in project memory).
 *
 * Draw gesture reused from: e2e/delete-object.spec.ts
 * (Tools group → Rectangle button → mouse drag on Stage SVG)
 */
test('multi-scene editor: per-scene object routing', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const stage = page.locator('section[aria-label="Stage"]');
  const scenesList = page.getByRole('list', { name: 'Scenes' });
  const tiles = scenesList.getByRole('listitem');

  // ── 1. Add a scene → 2 tiles in the Scenes strip ─────────────────────────
  await page.getByRole('button', { name: 'Add scene' }).click();
  await expect(tiles).toHaveCount(2);

  // ── 2. Draw a rectangle in the now-selected scene 2 ──────────────────────
  //    Gesture from delete-object.spec.ts: Tools group → Rectangle → drag.
  const rectTool = page
    .getByRole('group', { name: 'Tools' })
    .getByRole('button', { name: 'Rectangle', exact: true });
  const svg = stage.locator('svg').first();
  const box = (await svg.boundingBox())!;
  await rectTool.click();
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 120);
  await page.mouse.up();

  // Switch back to Select so the draw op is fully committed.
  await page.getByRole('button', { name: 'Select' }).click();

  // Scene 2 should now have 1 object visible in the Stage.
  // Stage-scoped: avoids collision with SceneStrip thumbnail data-savig-object elements.
  await expect(stage.locator('[data-savig-object]')).toHaveCount(1);

  // ── 3. Switch to scene 1 (empty) → Stage clears ──────────────────────────
  await tiles.nth(0).getByRole('button', { name: /^Scene/ }).click();
  await expect(stage.locator('[data-savig-object]')).toHaveCount(0);

  // ── 4. Switch back to scene 2 → rect returns (routing proof) ─────────────
  await tiles.nth(1).getByRole('button', { name: /^Scene/ }).click();
  await expect(stage.locator('[data-savig-object]')).toHaveCount(1);
});
