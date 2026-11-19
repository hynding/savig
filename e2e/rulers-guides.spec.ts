/**
 * Rulers and guides (spec 2026-11-19-rulers-guides), real Chromium: show the rulers, drag a guide
 * out of the left ruler, snap a rectangle's edge to it, move the guide, then drag it off the Stage
 * to remove it (and undo that).
 */
import { test, expect } from '@playwright/test';

test('drag a guide out of a ruler, snap to it, move it and remove it', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+Alt+Shift+r');
  const leftRuler = page.getByTestId('ruler-left');
  await expect(page.getByTestId('ruler-top')).toBeVisible();
  await expect(leftRuler).toBeVisible();

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;

  // Pull a vertical guide out of the left ruler to about 200px into the Stage.
  const lr = (await leftRuler.boundingBox())!;
  await page.mouse.move(lr.x + lr.width / 2, lr.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, lr.y + 200, { steps: 4 });
  await page.mouse.move(box.x + 200, lr.y + 200, { steps: 4 });
  await expect(page.getByTestId('guide-drag')).toBeVisible();
  await page.mouse.up();
  const guide = page.getByTestId('guide-x-0');
  await expect(guide).toHaveCount(1);
  const guideX = async () => {
    const b = (await guide.locator('line').first().boundingBox())!;
    return b.x + b.width / 2;
  };
  const gx = await guideX();
  expect(Math.abs(gx - (box.x + 200))).toBeLessThan(2);

  // Draw a rectangle left of the guide, then drag it so its right edge lands 3px short: it snaps.
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 60, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 170);
  await page.mouse.up();
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Select', exact: true }).click();
  const obj = page.locator('[data-savig-object]').first();
  const drag = async (dx: number) => {
    const b = (await obj.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + dx / 2, b.y + b.height / 2, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 3 });
    await page.mouse.up();
  };
  // (A move drag isn't 1:1 with the pointer when the Stage is scaled to fit; measure the ratio.)
  const ob = (await obj.boundingBox())!;
  await drag(20);
  const ratio = ((await obj.boundingBox())!.x - ob.x) / 20;
  const ob2 = (await obj.boundingBox())!;
  await drag((gx - (ob2.x + ob2.width) - 2) / ratio);
  const after = (await obj.boundingBox())!;
  expect(Math.abs(after.x + after.width - gx)).toBeLessThan(1);

  // Move the guide 60px right.
  const pos0 = Number(await guide.getAttribute('data-pos'));
  await page.mouse.move(gx, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(gx + 60, box.y + 300, { steps: 4 });
  await page.mouse.up();
  await expect(guide).not.toHaveAttribute('data-pos', String(pos0));
  const moved = await guideX();
  expect(Math.abs(moved - (gx + 60))).toBeLessThan(2);

  // Double-click it and type an exact position.
  await page.mouse.dblclick(moved, box.y + 300);
  const field = page.getByTestId('guide-pos-input');
  await field.fill('300');
  await field.press('Enter');
  await expect(guide).toHaveAttribute('data-pos', '300');
  await page.keyboard.press('Control+z');
  await expect(guide).not.toHaveAttribute('data-pos', '300');

  // Drag it back onto the ruler: removed. Undo brings it back.
  await page.mouse.move(moved, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(lr.x + lr.width / 2, box.y + 300, { steps: 4 });
  await page.mouse.up();
  await expect(guide).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(guide).toHaveCount(1);

  // Hide guides from the keyboard; the palette clears them.
  await page.keyboard.press('Control+;');
  await expect(guide).toHaveCount(0);
  await page.keyboard.press('Control+;');
  await expect(guide).toHaveCount(1);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByLabel('Command search').fill('clear guides');
  await palette.getByLabel('Command search').press('Enter');
  await expect(guide).toHaveCount(0);
});
