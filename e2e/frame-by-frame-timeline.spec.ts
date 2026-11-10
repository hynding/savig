/**
 * Frame-by-frame slice 3 (spec 2026-11-07 §Timeline, §Layers panel): the frame strip in the real
 * editor — filled vs hollow key dots, the right-click frame menu (label a key, F6 from the menu),
 * the Layers panel listing only the current frame's drawing, and clicking a drawing on the Stage
 * selecting that drawing rather than the whole layer.
 */
import { expect, test } from '@playwright/test';

test('frame strip, frame menu and Layers scoping', async ({ page }) => {
  await page.goto('/');
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const visible = page.locator('section[aria-label="Stage"] [data-savig-object][visibility="visible"]');
  const keys = page.locator('[data-testid^="frame-key-"]');
  const caption = page.locator('[data-testid^="frame-caption-"]');

  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByLabel('Command search').fill('new frame-by-frame layer');
  await palette.getByLabel('Command search').press('Enter');
  await expect(palette).toBeHidden();
  await expect(keys).toHaveCount(1);
  await expect(keys.first()).toHaveAttribute('data-blank', 'true');
  await expect(caption).toHaveText('Frame 1');

  // Draw into key 1: its dot fills in.
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 160);
  await page.mouse.up();
  await expect(keys.first()).toHaveAttribute('data-blank', 'false');

  // Right-click frame 3 on the strip → Insert Blank Keyframe: a hollow dot, nothing on screen.
  const strip = page.locator('[data-testid^="frame-strip-"]');
  const sb = (await strip.boundingBox())!;
  const cell = 100 / 30; // PX_PER_SECOND / default fps
  await strip.click({ button: 'right', position: { x: 2 * cell + 1, y: sb.height / 2 } });
  await page.getByTestId('frame-menu').getByRole('menuitem', { name: /Insert Blank Keyframe/ }).click();
  await expect(keys).toHaveCount(2);
  await expect(keys.nth(1)).toHaveAttribute('data-blank', 'true');
  await expect(visible).toHaveCount(0);
  await expect(caption).toHaveText('Frame 3');

  // Label that key from the menu; the flag shows on the strip and in the Layers caption.
  await strip.click({ button: 'right', position: { x: 2 * cell + 1, y: sb.height / 2 } });
  await page.getByLabel('Frame label').fill('blink');
  await page.getByLabel('Frame label').press('Enter');
  await expect(keys.nth(1)).toHaveText('blink');
  await expect(caption).toHaveText('Frame 3 · blink');

  // Back on frame 1: the Layers panel lists that frame's drawing, and clicking the drawing on the
  // Stage selects the drawing itself (its Layers row), not the whole layer.
  await strip.click({ position: { x: 1, y: sb.height / 2 } });
  await expect(caption).toHaveText('Frame 1');
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Select', exact: true }).click();
  await page.mouse.click(box.x + 130, box.y + 130);
  const layers = page.locator('[aria-label="Layers"] [data-depth="1"]');
  await expect(layers).toHaveCount(1);
  await expect(layers.first()).toHaveAttribute('data-selected', 'true');
});
