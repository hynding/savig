import { test, expect } from '@playwright/test';

test('dragging an object to centre it between two neighbors snaps to equal gaps + shows spacing guides', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const drawRect = async (x0: number, y0: number, x1: number, y1: number) => {
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.up();
  };

  // Trio kept in the LEFT third so the equidistant centre avoids the artboard centre (whose
  // edge-snap would otherwise claim the X axis and suppress spacing).
  await drawRect(80, 200, 120, 260); // L (left neighbor)
  await drawRect(300, 200, 340, 260); // R (right neighbor)
  await drawRect(240, 200, 280, 260); // M (mover) — off-centre (centre ~260; centred would be ~210)

  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const objects = page.locator('section[aria-label="Stage"] [data-savig-object]');
  await expect(objects).toHaveCount(3);
  const l = objects.nth(0);
  const r = objects.nth(1);
  const m = objects.nth(2);
  const lBox = (await l.boundingBox())!;
  const rBox = (await r.boundingBox())!;
  const mBox = (await m.boundingBox())!;

  // Target screen x for M's centre = midway between L's right edge and R's left edge.
  const centredCx = (lBox.x + lBox.width + rBox.x) / 2;
  const mCx = mBox.x + mBox.width / 2;
  const mCy = mBox.y + mBox.height / 2;

  // The SVG is CSS-scaled, so object-screen-px != mouse-px — measure how far M moves per mouse px,
  // then aim the mouse so M's centre lands on the equidistant point (within the 6px snap band).
  await page.mouse.move(mCx, mCy);
  await page.mouse.down();
  await page.mouse.move(mCx - 80, mCy); // probe move left
  const probe = (await m.boundingBox())!;
  const ratio = (mBox.x - probe.x) / 80; // object screen-px per mouse screen-px
  expect(ratio).toBeGreaterThan(0.1);
  const probeCx = probe.x + probe.width / 2;
  await page.mouse.move(mCx - 80 - (probeCx - centredCx) / ratio, mCy); // close the residual onto centre
  await expect(page.getByTestId('spacing-guide').first()).toBeAttached(); // dimension guides while dragging
  await page.mouse.up();
  await expect(page.getByTestId('spacing-guide')).toHaveCount(0); // cleared on release

  const mAfter = (await m.boundingBox())!;
  const gapLeft = mAfter.x - (lBox.x + lBox.width);
  const gapRight = rBox.x - (mAfter.x + mAfter.width);
  expect(Math.abs(gapLeft - gapRight)).toBeLessThan(2); // snapped to equal gaps
});
