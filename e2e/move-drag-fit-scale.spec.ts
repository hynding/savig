import { test, expect, type Page } from '@playwright/test';

// Regression: an object move drag divided the pointer delta by the store zoom only, ignoring the
// Stage svg's viewBox fit-to-container scale, so on a Stage smaller (or larger) than the artboard
// the object lagged (or overshot) the pointer. A small viewport forces a fit scale well below 1.
test.use({ viewport: { width: 1000, height: 640 } });

async function setup(page: Page) {
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
  // The artboard is fitted into the svg: confirm the fit scale is far from 1, else the test proves nothing.
  const fit = await svg.evaluate((el) => {
    const g = el.querySelector('g') as SVGGElement;
    const m = g.getScreenCTM()!;
    return Math.hypot(m.a, m.b);
  });
  expect(Math.abs(fit - 1)).toBeGreaterThan(0.15);
  return { drawRect, box };
}

const center = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

test('a single-object move drag keeps the object under the pointer when the Stage is fitted', async ({ page }) => {
  const { drawRect } = await setup(page);
  await drawRect(60, 60, 130, 120);
  const obj = page.locator('[data-savig-object]').first();
  await expect(obj).toHaveCount(1);
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Select', exact: true }).click();
  await obj.click();

  const before = (await obj.boundingBox())!;
  const c = center(before);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  // Ctrl bypasses object/grid snapping so the drop lands exactly where the pointer went.
  await page.keyboard.down('Control');
  await page.mouse.move(c.x + 40, c.y + 20, { steps: 4 });
  await page.mouse.move(c.x + 90, c.y + 50, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Control');

  const after = (await obj.boundingBox())!;
  expect(Math.abs(after.x - before.x - 90)).toBeLessThan(2);
  expect(Math.abs(after.y - before.y - 50)).toBeLessThan(2);
});

test('a multi-selection move drag tracks the pointer when the Stage is fitted', async ({ page }) => {
  const { drawRect } = await setup(page);
  await drawRect(60, 60, 120, 110);
  await drawRect(200, 150, 260, 200);
  const objects = page.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2);
  const a = objects.nth(0);
  const b = objects.nth(1);
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Select', exact: true }).click();
  await a.click();
  await b.click({ modifiers: ['Shift'] });

  const aBefore = (await a.boundingBox())!;
  const bBefore = (await b.boundingBox())!;
  const c = center(bBefore);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.keyboard.down('Control');
  await page.mouse.move(c.x + 70, c.y + 30, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Control');

  const aAfter = (await a.boundingBox())!;
  const bAfter = (await b.boundingBox())!;
  for (const [bf, af] of [[aBefore, aAfter], [bBefore, bAfter]] as const) {
    expect(Math.abs(af.x - bf.x - 70)).toBeLessThan(2);
    expect(Math.abs(af.y - bf.y - 30)).toBeLessThan(2);
  }
});
