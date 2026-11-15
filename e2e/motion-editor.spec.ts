import { test, expect, type Page } from '@playwright/test';

/** Draw a rect and key rotation 10 → 90 between t=0 and t=1 (auto-key is on by default). */
async function rotatingRect(page: Page) {
  await page.goto('/');
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 160);
  await page.mouse.up();
  const rot = page.getByLabel('rotation', { exact: true });
  await page.getByTestId('timeline-ruler').click({ position: { x: 0, y: 10 } });
  await rot.fill('10'); // a change, so auto-key records it
  await rot.press('Enter');
  await page.getByTestId('timeline-ruler').click({ position: { x: 100, y: 10 } });
  await rot.fill('90');
  await rot.press('Enter');
}

test('the Graph toggle shows the selected object rotation curve; clicking a key selects it', async ({ page }) => {
  await rotatingRect(page);
  await page.getByTestId('graph-toggle').click();
  await expect(page.getByTestId('graph-editor')).toBeVisible();
  await expect(page.getByTestId('graph-chip-rotation')).toHaveAttribute('aria-pressed', 'true');
  const k0 = page.getByTestId('graph-key-rotation-0');
  const k1 = page.getByTestId('graph-key-rotation-1');
  const b0 = (await k0.boundingBox())!;
  const b1 = (await k1.boundingBox())!;
  expect(b1.x - b0.x).toBeGreaterThan(90); // one second apart on the Timeline scale
  expect(b1.y).toBeLessThan(b0.y); // 90° is above 10°
  await k1.click();
  await expect(page.getByTestId('graph-key-rotation-1')).toHaveClass(/graphKeySelected/);
});

test('dragging a graph key retimes and revalues it; dragging a handle eases the segment', async ({ page }) => {
  await rotatingRect(page);
  await page.getByTestId('graph-toggle').click();
  const rot = page.getByLabel('rotation', { exact: true });

  // Drag the 90° key up: its value rises (the axis is frozen during the drag).
  const k1 = (await page.getByTestId('graph-key-rotation-1').boundingBox())!;
  await page.mouse.move(k1.x + k1.width / 2, k1.y + k1.height / 2);
  await page.mouse.down();
  await page.mouse.move(k1.x + k1.width / 2, k1.y + k1.height / 2 - 20, { steps: 4 });
  await expect(page.getByTestId('graph-readout')).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId('graph-key-rotation-1')).toHaveCount(1);
  await page.getByTestId('timeline-ruler').click({ position: { x: 100, y: 10 } });
  await expect.poll(async () => Number(await rot.inputValue())).toBeGreaterThan(95);
  const raised = Number(await rot.inputValue());

  // Drag the segment's out-handle right and down: an ease-in, so at 0.5 s the value lags the
  // straight line between the keys.
  const h = (await page.getByTestId('graph-handle-out-0').boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 30, h.y + h.height / 2 + 25, { steps: 4 });
  await page.mouse.up();
  await page.getByTestId('timeline-ruler').click({ position: { x: 50, y: 10 } });
  // The Inspector follows the playhead a frame later, so poll.
  await expect.poll(async () => Number(await rot.inputValue())).toBeLessThan((10 + raised) / 2 - 2);
});

test('screenshot: motion editor graph', async ({ page }) => {
  test.skip(!process.env.GRAPH_SHOT, 'manual visual check');
  await rotatingRect(page);
  await page.getByTestId('graph-toggle').click();
  await page.getByTestId('graph-key-rotation-1').click();
  await page.screenshot({ path: process.env.GRAPH_SHOT!, fullPage: false });
});
