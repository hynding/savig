import { test, expect } from '@playwright/test';

async function drawRect(page, x1: number, y1: number, x2: number, y2: number) {
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2);
  await page.mouse.up();
}

// mod+alt chords: on macOS, Option composes a letter into an accented character (e.g. Option+C
// types 'ç'), so a real user's Cmd+Option+C delivers KeyboardEvent.key === 'ç', not 'c'. Sending
// Playwright's physical-key form (KeyC/KeyV) reproduces that real event shape; chordMatches now
// resolves it via KeyEvent.code (final-review Fix 2), so this exercises the REAL matching path
// end-to-end rather than sidestepping it.
const COPY_STYLE = process.platform === 'darwin' ? 'Meta+Alt+KeyC' : 'Control+Alt+KeyC';
const PASTE_STYLE = process.platform === 'darwin' ? 'Meta+Alt+KeyV' : 'Control+Alt+KeyV';

test('copy style / paste style moves fill between rects', async ({ page }) => {
  await page.goto('/');
  await drawRect(page, 60, 60, 140, 120); // rect A
  await drawRect(page, 180, 60, 260, 120); // rect B
  const shapes = page.locator('section[aria-label="Stage"] [data-savig-object] > *');
  await expect(shapes).toHaveCount(2);

  // Auto-key stays ON (the default): the fill edit below lands in a colorTracks keyframe, not
  // the static asset style. copyStyle captures the playhead-SAMPLED paint (final-review Fix 1),
  // so it still picks up the visible color even though the asset's static style is stale.
  const autoKeyToggle = page.getByRole('button', { name: 'Auto-key' });
  await expect(autoKeyToggle).toHaveAttribute('aria-pressed', 'true');

  // Select A and recolor it so the two fills differ, then copy A's style.
  await shapes.first().click();
  const fillField = page.getByLabel('fill', { exact: true });
  await fillField.fill('#ff0000');
  await fillField.blur(); // the chord below is ignored while focus sits in an editable field
  await page.keyboard.press(COPY_STYLE);

  // Select B, paste style.
  await shapes.nth(1).click();
  await page.keyboard.press(PASTE_STYLE);
  await expect(shapes.nth(1)).toHaveAttribute('fill', '#ff0000');
});

test('eyedropper restyles the selection from the clicked object', async ({ page }) => {
  await page.goto('/');
  await drawRect(page, 60, 60, 140, 120); // rect A
  await drawRect(page, 180, 60, 260, 120); // rect B
  const shapes = page.locator('section[aria-label="Stage"] [data-savig-object] > *');
  await expect(shapes).toHaveCount(2);

  // Same reasoning as above: auto-key stays ON, so applyStyleFrom captures the SAMPLED fill
  // (final-review Fix 1) rather than the stale static asset style.
  const autoKeyToggle = page.getByRole('button', { name: 'Auto-key' });
  await expect(autoKeyToggle).toHaveAttribute('aria-pressed', 'true');

  await shapes.first().click();
  const fillField = page.getByLabel('fill', { exact: true });
  await fillField.fill('#00aa00');
  await fillField.blur();

  // Select B, hit the eyedropper key, click A.
  await shapes.nth(1).click();
  await page.keyboard.press('i');
  await shapes.first().click();
  await expect(shapes.nth(1)).toHaveAttribute('fill', '#00aa00');
  await expect(page.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true');
});
