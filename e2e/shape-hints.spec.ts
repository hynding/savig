/**
 * Shape hints slice 2 (spec 2026-11-14-shape-hints): on a shape tween's start key, "+ Hint" adds a
 * lettered marker on the start drawing; dragging it re-bakes the morph; the end key shows the
 * matching marker on the end drawing; Ctrl+Shift+H adds another; right-click deletes one; undo and
 * Clear hints work.
 */
import { expect, test } from '@playwright/test';

test('add, drag, view at the end key, delete and clear shape hints', async ({ page }) => {
  await page.goto('/');
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const visible = page.locator('section[aria-label="Stage"] [data-savig-object][visibility="visible"]');
  const outline = () => visible.first().locator('xpath=descendant-or-self::*[@d]').first();
  const keys = page.locator('[data-testid^="frame-key-"]');

  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByLabel('Command search').fill('new frame-by-frame layer');
  await palette.getByLabel('Command search').press('Enter');
  await expect(palette).toBeHidden();

  const draw = async (tool: string, x0: number, y0: number, x1: number, y1: number) => {
    await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: tool, exact: true }).click();
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.up();
  };
  await draw('Rectangle', 100, 100, 200, 200);
  const strip = page.locator('[data-testid^="frame-strip-"]');
  const sb = (await strip.boundingBox())!;
  const cell = 100 / 30;
  const at = (frame: number) => ({ x: (frame - 1) * cell + 1, y: sb.height / 2 });
  const menuItem = (name: RegExp) => page.getByTestId('frame-menu').getByRole('menuitem', { name });
  await strip.click({ button: 'right', position: at(11) });
  await menuItem(/Insert Blank Keyframe/).click();
  await expect(keys).toHaveCount(2);
  await draw('Ellipse', 300, 100, 400, 200);
  await strip.click({ button: 'right', position: at(1) });
  await menuItem(/Create Shape Tween/).click();

  // On the start key: no markers yet; "+ Hint" adds marker a on the start drawing.
  await strip.click({ position: at(1) });
  const row = page.getByTestId('inspector-shape-tween');
  await expect(row.getByTestId('inspector-shape-hints')).toHaveText('Hints 0');
  await expect(page.getByTestId('shape-hint-overlay')).toHaveCount(0);
  await row.getByTestId('inspector-add-shape-hint').click();
  await expect(row.getByTestId('inspector-shape-hints')).toHaveText('Hints 1');
  const hintA = page.getByTestId('shape-hint-a-0');
  await expect(hintA).toBeVisible();
  await expect(hintA).toHaveAttribute('data-valid', 'true');

  // Mid-span shape before the drag.
  await strip.click({ position: at(6) });
  await expect(page.getByTestId('shape-hint-overlay')).toHaveCount(0); // markers only on key frames
  const dBefore = await outline().getAttribute('d');

  // Drag marker a to the rectangle's bottom-right corner: it snaps there and the morph re-bakes.
  await strip.click({ position: at(1) });
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Select', exact: true }).click();
  const xBefore = await hintA.getAttribute('data-x');
  const hb = (await hintA.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 190, { steps: 4 });
  await page.mouse.move(box.x + 203, box.y + 203, { steps: 4 });
  await page.mouse.up();
  await expect(hintA).not.toHaveAttribute('data-x', xBefore!);
  await strip.click({ position: at(6) });
  await expect(outline()).not.toHaveAttribute('d', dBefore!);

  // The end key shows the hint's partner (b) on the end drawing.
  await strip.click({ position: at(11) });
  await expect(page.getByTestId('shape-hint-b-0')).toBeVisible();
  await expect(page.getByTestId('shape-hint-a-0')).toHaveCount(0);

  // Ctrl+Shift+H adds hint b(=second) on the start key; right-click deletes it; undo restores.
  await strip.click({ position: at(1) });
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Select', exact: true }).click();
  await page.keyboard.press('Control+Shift+H');
  await expect(page.getByTestId('shape-hint-a-1')).toBeVisible();
  await page.getByTestId('shape-hint-a-1').click({ button: 'right' });
  await expect(page.getByTestId('shape-hint-a-1')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('shape-hint-a-1')).toBeVisible();

  // Clear hints removes them all.
  await row.getByTestId('inspector-remove-shape-hints').click();
  await expect(page.getByTestId('shape-hint-overlay')).toHaveCount(0);
  await expect(row.getByTestId('inspector-shape-hints')).toHaveText('Hints 0');
});
