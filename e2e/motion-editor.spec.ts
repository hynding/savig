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

test('screenshot: motion editor graph', async ({ page }) => {
  test.skip(!process.env.GRAPH_SHOT, 'manual visual check');
  await rotatingRect(page);
  await page.getByTestId('graph-toggle').click();
  await page.getByTestId('graph-key-rotation-1').click();
  await page.screenshot({ path: process.env.GRAPH_SHOT!, fullPage: false });
});
