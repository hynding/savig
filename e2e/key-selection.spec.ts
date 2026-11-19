/**
 * Multi-keyframe selection (spec 2026-11-19-key-selection), real Chromium: box-select two keys on
 * the Timeline, drag them together, stretch the range, reverse it from the command palette, then
 * copy, paste and delete with the keyboard.
 */
import { test, expect } from '@playwright/test';

test('box-select keys, move, stretch, reverse, copy/paste and delete them', async ({ page }) => {
  await page.goto('/');
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 160);
  await page.mouse.up();

  // Rotation keys at 0s (40°) and 1s (90°).
  const rot = page.getByLabel('rotation', { exact: true });
  await rot.fill('40');
  await rot.blur();
  await page.getByTestId('timeline-ruler').click({ position: { x: 100, y: 10 } });
  await rot.fill('90');
  await rot.blur();
  const key = (t: number) => page.locator(`[data-testid^="keyframe-"][data-testid$="-rotation-${t}"]`);
  await expect(key(0)).toHaveCount(1);
  await expect(key(1)).toHaveCount(1);
  const rowId = (await key(0).getAttribute('data-testid'))!.replace(/^keyframe-/, '').replace(/-rotation-0$/, '');

  // Box-select across both keys (start on empty lane space left of the first key).
  const lane = page.locator(`[data-lane-row="${rowId}"]`);
  const lb = (await lane.boundingBox())!;
  await page.mouse.move(lb.x + 2, lb.y + 2);
  await page.mouse.down();
  await page.mouse.move(lb.x + 140, lb.y + lb.height - 2, { steps: 4 });
  await expect(page.getByTestId('key-marquee')).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId(`key-band-${rowId}`)).toBeVisible();

  // Drag the first key 50px right: both keys move half a second.
  const k0 = (await key(0).boundingBox())!;
  await page.mouse.move(k0.x + k0.width / 2, k0.y + k0.height / 2);
  await page.mouse.down();
  await page.mouse.move(k0.x + k0.width / 2 + 50, k0.y + k0.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(key(0.5)).toHaveCount(1);
  await expect(key(1.5)).toHaveCount(1);

  // Stretch the range to end at 2.5s (drag the band's right edge 100px).
  const handle = page.getByTestId(`key-band-stretch-${rowId}`);
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 100, hb.y + hb.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(key(2.5)).toHaveCount(1);
  await expect(key(1.5)).toHaveCount(0);

  // Reverse from the command palette: the 40° key is now at the end.
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByLabel('Command search').fill('reverse keyframes');
  await palette.getByLabel('Command search').press('Enter');
  await expect(palette).toBeHidden();
  await page.getByTestId('timeline-ruler').click({ position: { x: 250, y: 10 } });
  await expect(rot).toHaveValue('40');

  // Copy and paste: keys land relative to the playhead.
  await page.keyboard.press('Control+c');
  // (The playhead is at 2.5s, the end of the timeline; the paste lands there and runs past it.)
  await page.keyboard.press('Control+v');
  await expect(key(4.5)).toHaveCount(1);

  // The pasted range is selected; Delete removes just those keys.
  await page.keyboard.press('Delete');
  await expect(key(4.5)).toHaveCount(0);
  await expect(key(2.5)).toHaveCount(0);
  await expect(key(0.5)).toHaveCount(1);
});
