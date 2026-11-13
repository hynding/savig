/**
 * Shape tween slice 1 (spec 2026-11-13-shape-tween): Create Shape Tween from the frame menu morphs
 * key 1's rectangle into key 2's ellipse across the span; the strip shows the tween band; undo and
 * Remove Shape Tween bring back the held drawing.
 */
import { expect, test } from '@playwright/test';

test('create, scrub, undo and remove a shape tween', async ({ page }) => {
  await page.goto('/');
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const visible = page.locator('section[aria-label="Stage"] [data-savig-object][visibility="visible"]');
  const keys = page.locator('[data-testid^="frame-key-"]');
  // The drawing's outline element (the object node itself or its first descendant with a `d`).
  const outline = () => visible.first().locator('xpath=descendant-or-self::*[@d]').first();
  const tweenSpan = page.locator('[data-testid^="frame-span-"][data-tween="shape"]');

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
  await draw('Rectangle', 100, 100, 160, 160);

  const strip = page.locator('[data-testid^="frame-strip-"]');
  const sb = (await strip.boundingBox())!;
  const cell = 100 / 30; // PX_PER_SECOND / default fps
  const at = (frame: number) => ({ x: (frame - 1) * cell + 1, y: sb.height / 2 });
  const menuItem = (name: RegExp) => page.getByTestId('frame-menu').getByRole('menuitem', { name });

  await strip.click({ button: 'right', position: at(11) });
  await menuItem(/Insert Blank Keyframe/).click();
  await expect(keys).toHaveCount(2);
  await draw('Ellipse', 300, 100, 360, 160);
  await expect(keys.nth(1)).toHaveAttribute('data-blank', 'false');

  // Create Shape Tween on key 1's span: the band is tinted, the drawing morphs mid-span.
  await strip.click({ button: 'right', position: at(1) });
  await menuItem(/Create Shape Tween/).click();
  await expect(tweenSpan).toHaveCount(1);
  await expect(visible).toHaveCount(1);
  const dStart = await outline().getAttribute('d');
  expect(dStart).toBeTruthy();
  await strip.click({ position: at(6) });
  await expect(visible).toHaveCount(1);
  await expect(outline()).not.toHaveAttribute('d', dStart!);
  const dLinear = await outline().getAttribute('d');
  // The Inspector (layer targeted) shows the tween with its easing; switching it re-bakes.
  const row = page.getByTestId('inspector-shape-tween');
  await expect(row.getByLabel('Shape tween easing')).toHaveValue('linear');
  await row.getByLabel('Shape tween easing').selectOption('easeIn');
  await expect(row.getByLabel('Shape tween easing')).toHaveValue('easeIn');
  await expect(outline()).not.toHaveAttribute('d', dLinear!);
  const dMid = await outline().getAttribute('d');

  // Undo steps back one edit at a time (easing change, then the tween itself); redo restores.
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Select', exact: true }).click();
  await page.keyboard.press('Control+z');
  await expect(outline()).toHaveAttribute('d', dLinear!);
  await page.keyboard.press('Control+z');
  await expect(tweenSpan).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  await expect(tweenSpan).toHaveCount(1);
  await expect(outline()).toHaveAttribute('d', dMid!);

  // Remove Shape Tween from the menu: the start drawing holds across the span again.
  await strip.click({ button: 'right', position: at(6) });
  await menuItem(/Remove Shape Tween/).click();
  await expect(tweenSpan).toHaveCount(0);
  await expect(outline()).toHaveAttribute('d', dStart!);
});
