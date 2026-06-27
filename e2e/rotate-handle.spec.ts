import { test, expect } from '@playwright/test';

test('drag the rotate handle rotates the object', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect, then switch to the select tool.
  await page.getByRole('button', { name: 'Rectangle' }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 200);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Select' }).click();

  const obj = page.locator('[data-savig-object]').first();
  const before = await obj.getAttribute('transform');

  // Drag the rotate handle in an arc around the object.
  const handle = page.getByTestId('rotate-handle');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 80, hb.y + 80); // sweep to the side
  await page.mouse.up();

  const after = await obj.getAttribute('transform');
  expect(after).not.toBe(before);
  expect(after).toMatch(/rotate\(/);
  // The rotate angle is non-zero (not "rotate(0, ...").
  expect(after).not.toMatch(/rotate\(0,/);
});

test('rotating near a 45° multiple snaps the angle (magnetic, snap on)', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Rectangle' }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 200);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Select' }).click();

  const obj = page.locator('[data-savig-object]').first();
  const oBox = (await obj.boundingBox())!;
  const pivot = { x: oBox.x + oBox.width / 2, y: oBox.y + oBox.height / 2 }; // rotation pivot (object centre)

  const handle = page.getByTestId('rotate-handle');
  const hb = (await handle.boundingBox())!;
  const hc = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
  const r = Math.hypot(hc.x - pivot.x, hc.y - pivot.y); // keep the cursor on the handle's circle

  // The start handle sits straight above the pivot (screen angle −90°), so object rotation =
  // screenAngle(cursor) + 90. Aim the cursor at −47° → ~43° rotation, 2° inside the 5° snap band.
  const rad = (-47 * Math.PI) / 180;
  const target = { x: pivot.x + r * Math.cos(rad), y: pivot.y + r * Math.sin(rad) };
  await page.mouse.move(hc.x, hc.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y);

  // Mid-drag the readout HUD shows the snapped angle and flags the snap.
  const readout = page.getByTestId('rotate-readout');
  await expect(readout).toHaveText('45°');
  await expect(readout).toHaveAttribute('data-snapped', 'true');

  await page.mouse.up();
  await expect(readout).toHaveCount(0); // cleared on release

  const after = await obj.getAttribute('transform');
  const m = after?.match(/rotate\(([-\d.]+)/);
  expect(m).not.toBeNull();
  const angle = parseFloat(m![1]);
  expect(Math.abs(angle - 45)).toBeLessThan(0.5); // magnetically snapped to exactly 45° (a free drag would land ~43°)
});
