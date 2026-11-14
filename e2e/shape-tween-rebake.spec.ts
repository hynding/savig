/**
 * Automatic shape tween re-bake (spec 2026-11-14-tween-rebake): after creating a tween, dragging
 * the END drawing on its own keyframe updates the morph with no "Update" press; one undo puts
 * both the drawing and the morph back.
 */
import { expect, test } from '@playwright/test';

test('moving the end drawing updates the shape tween automatically', async ({ page }) => {
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
  await draw('Rectangle', 100, 100, 160, 160);
  const strip = page.locator('[data-testid^="frame-strip-"]');
  const sb = (await strip.boundingBox())!;
  const cell = 100 / 30;
  const at = (frame: number) => ({ x: (frame - 1) * cell + 1, y: sb.height / 2 });
  const menuItem = (name: RegExp) => page.getByTestId('frame-menu').getByRole('menuitem', { name });
  await strip.click({ button: 'right', position: at(11) });
  await menuItem(/Insert Blank Keyframe/).click();
  await expect(keys).toHaveCount(2);
  await draw('Ellipse', 300, 100, 360, 160);
  await strip.click({ button: 'right', position: at(1) });
  await menuItem(/Create Shape Tween/).click();

  await strip.click({ position: at(6) });
  const dBefore = await outline().getAttribute('d');

  // On the end keyframe, drag the ellipse 100px down.
  await strip.click({ position: at(11) });
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Select', exact: true }).click();
  await page.mouse.move(box.x + 330, box.y + 130);
  await page.mouse.down();
  await page.mouse.move(box.x + 330, box.y + 180, { steps: 4 });
  await page.mouse.move(box.x + 330, box.y + 230, { steps: 4 });
  await page.mouse.up();

  // Mid-tween, the morph now heads to the new spot — no Update needed.
  await strip.click({ position: at(6) });
  await expect(outline()).not.toHaveAttribute('d', dBefore!);

  // One undo restores the drawing AND the morph.
  await page.keyboard.press('Control+z');
  await expect(outline()).toHaveAttribute('d', dBefore!);
});
