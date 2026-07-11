import { test, expect } from '@playwright/test';

test('outline stroke converts a Line to a filled ink ring; undo restores the stroked path', async ({ page }) => {
  await page.goto('/');

  // The Line tool commits a 2-node OPEN vector path (linePath -> closed: false) via
  // addVectorPath, which auto-selects the new object (see scissors.spec.ts). So the object is
  // already selected and its style shows in the Inspector by the time the draw is done.
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + 80);
  await page.mouse.up();

  const stage = page.locator('section[aria-label="Stage"]');
  const stageObjects = stage.locator('[data-savig-object]');
  await expect(stageObjects).toHaveCount(1);
  const path = stageObjects.locator('path').first();

  // Read the line's default stroke color from the Inspector rather than setting one: auto-key
  // is ON by default (style-tools.spec.ts), so a color-input edit lands in a colorTracks
  // keyframe (imperatively patched onto the DOM by applyFrame) rather than the static
  // asset.style.stroke that outlineStroke's gate/effect actually reads (store.ts
  // outlineStroke() / computeOutlineStrokeEffect) -- editing it here would desync the
  // assertion from what the op sees. The Line tool's default is deterministic
  // ('#000000', PATH_DEFAULT_STYLE via linePath), so this is still a solid, non-tautological
  // assertion.
  const strokeInput = page.locator('input[aria-label="stroke"]');
  const strokeColor = await strokeInput.inputValue();
  expect(strokeColor).toBe('#000000');
  await expect(path).toHaveAttribute('stroke', strokeColor);

  const dBefore = (await path.getAttribute('d')) ?? '';
  expect(dBefore).not.toContain('Z'); // open 2-node line, no close command yet
  const fillBefore = await path.getAttribute('fill'); // the Line tool's default: 'none' (stroke-only)

  await page.getByRole('button', { name: 'Outline stroke', exact: true }).click();

  // The stroke became the fill of a closed ink ring; stroke is cleared.
  await expect(path).toHaveAttribute('fill', strokeColor);
  const strokeAfter = await path.getAttribute('stroke');
  expect(strokeAfter === null || strokeAfter === 'none').toBe(true);
  const dAfter = (await path.getAttribute('d')) ?? '';
  expect(dAfter).toContain('Z');

  // Single-commit pin: one undo restores the pre-outline stroked path.
  await page.keyboard.press('ControlOrMeta+KeyZ');
  await expect(path).toHaveAttribute('stroke', strokeColor);
  const dRestored = (await path.getAttribute('d')) ?? '';
  expect(dRestored).not.toContain('Z');
  expect(dRestored).toBe(dBefore);
  const fillRestored = await path.getAttribute('fill');
  expect(fillRestored).toBe(fillBefore); // fill reverts too — the outline's fill-swap is undone
});

test('Outline stroke is disabled for a non-path shape (rect)', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + 200);
  await page.mouse.up();

  const stageObjects = page.locator('section[aria-label="Stage"] [data-savig-object]');
  await expect(stageObjects).toHaveCount(1);

  await expect(page.getByRole('button', { name: 'Outline stroke', exact: true })).toBeDisabled();
});
