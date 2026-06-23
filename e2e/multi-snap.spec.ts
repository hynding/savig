import { test, expect } from '@playwright/test';

// Dragging a multi-selection should snap the GROUP bbox to another object's edges (slice 44),
// just like a single-object drag. We assert in screen space that, after dragging the group up
// to a target object, one of the group's vertical edges/center ends aligned with one of the
// target's — evidence the snap engaged (without it the group would stop at the raw cursor).
test('dragging a multi-selection snaps the group edge to another object', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });

  const drawRect = async (x0: number, y0: number, x1: number, y1: number) => {
    await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.up();
  };

  await drawRect(360, 80, 380, 320); // T (tall, isolated target on the right)
  await drawRect(80, 120, 120, 160); // A
  await drawRect(150, 120, 190, 160); // B

  const objects = page.locator('[data-savig-object]');
  await expect(objects).toHaveCount(3);
  const t = objects.nth(0);
  const a = objects.nth(1);
  const b = objects.nth(2);

  // Select A, B (not T).
  await a.click();
  await b.click({ modifiers: ['Shift'] });

  const tb = (await t.boundingBox())!;
  const aBefore = (await a.boundingBox())!;
  const bBefore = (await b.boundingBox())!;
  // Objects move at artboard rate, so a cursor move maps to a scale× object move
  // (scale = stage screen width / artboard width). Convert the desired group shift
  // (right edge -> T's left edge) into the cursor delta, with a little overshoot to land
  // inside the snap threshold; the snap then pulls the edge into exact alignment.
  const scale = box.width / 1280;
  const wantShift = tb.x - (bBefore.x + bBefore.width); // screen px to move the group's right edge to T's left
  const delta = wantShift / scale + 4;
  const ac = { x: aBefore.x + aBefore.width / 2, y: aBefore.y + aBefore.height / 2 };
  await page.mouse.move(ac.x, ac.y);
  await page.mouse.down();
  await page.mouse.move(ac.x + delta, ac.y);
  await page.mouse.up();

  const aAfter = (await a.boundingBox())!;
  const bAfter = (await b.boundingBox())!;
  expect(aAfter.x).toBeGreaterThan(aBefore.x + 10); // the group actually moved right

  // The group's vertical lines (left=a.left, center, right=b.right) vs T's (left/center/right).
  const groupLines = [aAfter.x, (aAfter.x + bAfter.x + bAfter.width) / 2, bAfter.x + bAfter.width];
  const tLines = [tb.x, tb.x + tb.width / 2, tb.x + tb.width];
  const minGap = Math.min(...groupLines.flatMap((g) => tLines.map((tl) => Math.abs(g - tl))));
  expect(minGap).toBeLessThan(2); // an edge/center snapped into alignment with the target
});
