import { test, expect } from '@playwright/test';

test('subtract an interior shape -> an annulus (compound path with a hole)', async ({ page }) => {
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

  await drawRect(80, 80, 360, 360); // big (bottom-most)
  await drawRect(400, 180, 440, 220); // small, drawn in an empty area to the right (upper)

  const objects = page.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2);

  // Drag the small rect so its centre lands on the big rect's MEASURED centre (robust to the
  // stage zoom) — small is much smaller than big, so it ends up safely interior -> a hole.
  const big = objects.nth(0);
  const small = objects.nth(1);
  const bigBox = (await big.boundingBox())!;
  const sBox = (await small.boundingBox())!;
  const from = { x: sBox.x + sBox.width / 2, y: sBox.y + sBox.height / 2 };
  const to = { x: bigBox.x + bigBox.width / 2, y: bigBox.y + bigBox.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2);
  await page.mouse.move(to.x, to.y);
  await page.mouse.up();

  // Sanity: the small rect is now fully inside the big rect's box.
  const sNow = (await small.boundingBox())!;
  expect(sNow.x).toBeGreaterThan(bigBox.x);
  expect(sNow.x + sNow.width).toBeLessThan(bigBox.x + bigBox.width);
  expect(sNow.y).toBeGreaterThan(bigBox.y);
  expect(sNow.y + sNow.height).toBeLessThan(bigBox.y + bigBox.height);

  // Select both: click the big rect in a corner NOT covered by the small one (its local
  // top-left), then shift-click the small one (its centre).
  await big.click({ position: { x: 8, y: 8 } });
  await small.click({ modifiers: ['Shift'] });
  await expect(page.getByText(/2 objects selected/i)).toBeVisible();

  await page.getByRole('button', { name: 'Subtract', exact: true }).click();

  // Destructive replace: the two sources collapse into one result object.
  await expect(objects).toHaveCount(1);

  // The result renders as a compound path: fill-rule evenodd + two M…Z subpaths (outer + hole).
  const path = page.locator('[data-savig-object] path').first();
  await expect(path).toHaveAttribute('fill-rule', 'evenodd');
  const d = (await path.getAttribute('d')) ?? '';
  expect((d.match(/M /g) || []).length).toBeGreaterThanOrEqual(2);
});

test('subtract an interior ellipse preserves curves in the rendered path', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });

  const draw = async (tool: 'Rectangle' | 'Ellipse', x0: number, y0: number, x1: number, y1: number) => {
    await tools.getByRole('button', { name: tool, exact: true }).click();
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.up();
  };

  await draw('Rectangle', 80, 80, 360, 360); // big (bottom-most)
  await draw('Ellipse', 400, 180, 460, 240); // small, in an empty area to the right (upper)

  // Scope to the Stage so AssetPanel symbol-thumbnail [data-savig-object] can't collide (293ccf5).
  const objects = page.locator('section[aria-label="Stage"] [data-savig-object]');
  await expect(objects).toHaveCount(2);

  // Drag the ellipse so its centre lands on the rect's MEASURED centre -> fully interior.
  const big = objects.nth(0);
  const small = objects.nth(1);
  const bigBox = (await big.boundingBox())!;
  const sBox = (await small.boundingBox())!;
  const from = { x: sBox.x + sBox.width / 2, y: sBox.y + sBox.height / 2 };
  const to = { x: bigBox.x + bigBox.width / 2, y: bigBox.y + bigBox.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2);
  await page.mouse.move(to.x, to.y);
  await page.mouse.up();

  // Sanity: the ellipse is now fully inside the rect's box (so the subtract really cuts a hole).
  const sNow = (await small.boundingBox())!;
  expect(sNow.x).toBeGreaterThan(bigBox.x);
  expect(sNow.x + sNow.width).toBeLessThan(bigBox.x + bigBox.width);
  expect(sNow.y).toBeGreaterThan(bigBox.y);
  expect(sNow.y + sNow.height).toBeLessThan(bigBox.y + bigBox.height);

  // Select rect (top-left corner, clear of the ellipse) + ellipse (its centre).
  await big.click({ position: { x: 8, y: 8 } });
  await small.click({ modifiers: ['Shift'] });
  await expect(page.getByText(/2 objects selected/i)).toBeVisible();

  await page.getByRole('button', { name: 'Subtract', exact: true }).click();
  await expect(objects).toHaveCount(1);

  // Curvature survived to the DOM: the curved hole where the ellipse cut emits a cubic command.
  const path = page.locator('[data-savig-object] path').first();
  const d = (await path.getAttribute('d')) ?? '';
  expect(d).toMatch(/[Cc]/);
});

test('node-edit a boolean hole reshapes the compound ring', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });
  const stage = page.locator('section[aria-label="Stage"]');

  const draw = async (tool: 'Rectangle' | 'Ellipse', x0: number, y0: number, x1: number, y1: number) => {
    await tools.getByRole('button', { name: tool, exact: true }).click();
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.up();
  };

  await draw('Rectangle', 80, 80, 360, 360);
  await draw('Ellipse', 400, 180, 460, 240); // empty area, upper

  const objects = stage.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2);

  // Drag the ellipse fully interior so the subtract cuts a hole.
  const big = objects.nth(0);
  const small = objects.nth(1);
  const bigBox = (await big.boundingBox())!;
  const sBox = (await small.boundingBox())!;
  const from = { x: sBox.x + sBox.width / 2, y: sBox.y + sBox.height / 2 };
  const to = { x: bigBox.x + bigBox.width / 2, y: bigBox.y + bigBox.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2);
  await page.mouse.move(to.x, to.y);
  await page.mouse.up();

  await big.click({ position: { x: 8, y: 8 } });
  await small.click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Subtract', exact: true }).click();
  await expect(objects).toHaveCount(1);

  // Switch to the Node tool; the result stays selected so its node overlay appears.
  await tools.getByRole('button', { name: 'Node', exact: true }).click();

  const before = (await stage.locator('[data-savig-object] path').first().getAttribute('d')) ?? '';

  // A compound-ring (hole) handle is ring 1 -> data-testid="node-1-<i>". Drag the first one.
  const holeHandle = stage.locator('[data-testid^="node-1-"]').first();
  await expect(holeHandle).toBeVisible();
  const hb = (await holeHandle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 30, hb.y + 30);
  await page.mouse.up();

  const after = (await stage.locator('[data-savig-object] path').first().getAttribute('d')) ?? '';
  expect(after).not.toBe(before);
});

test('Alt+Union creates a live boolean that keeps its operands', async ({ page }) => {
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
  await drawRect(80, 80, 200, 200); // two separate rects (disjoint union is still non-empty)
  await drawRect(260, 80, 380, 200);

  const stage = page.locator('section[aria-label="Stage"]');
  const objects = stage.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2);
  await objects.nth(0).click({ position: { x: 8, y: 8 } });
  await objects.nth(1).click({ modifiers: ['Shift'], position: { x: 8, y: 8 } });
  await expect(page.getByText(/2 objects selected/i)).toBeVisible();

  await page.getByRole('button', { name: 'Union', exact: true }).click({ modifiers: ['Alt'] });
  // Live boolean KEEPS its operands (data), but slice-1 render-HIDES them, so the Stage shows only
  // the result (1). The kept operands persist in the LAYERS tree → 3 rows (2 operands + result);
  // a destructive Union would consume the operands and leave 1 layer row.
  const layers = page.locator('[aria-label="Layers"]');
  await expect(layers.locator('[data-testid^="layer-"]')).toHaveCount(3);
  await expect(objects).toHaveCount(1); // operands render-hidden, result drawn
  await expect(stage.locator('[data-savig-object] path').first()).toBeVisible();
});
