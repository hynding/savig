import { test, expect } from '@playwright/test';

/** 9-slice scaling (roadmap 13): a symbol with a scale-9 grid draws as nine clipped cells; when
 *  the instance is stretched, the corner cells keep their size. Clicking a cell still selects the
 *  instance, and editing inside the symbol shows the grid guides. */
test('a 9-slice symbol keeps its corners when stretched', async ({ page }) => {
  await page.goto('/');
  const stage = page.locator('section[aria-label="Stage"]');
  const svg = stage.locator('svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });

  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 160);
  await page.mouse.up();
  await stage.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  const instance = stage.locator('[data-savig-object*="/"]');
  await expect(instance).toHaveCount(1);
  await instance.first().click();

  // Turn on 9-slice: nine cells, each with its own clip.
  await page.getByTestId('symbol-scale9').check();
  await expect(page.getByTestId('symbol-scale9-grid')).toBeVisible();
  const cells = stage.locator('g[data-savig-object*="~"]');
  await expect(cells).toHaveCount(9);
  await expect(stage.locator('svg clipPath')).toHaveCount(9);

  // Stretch the instance 3x wide: the top-left corner cell keeps scale 1 while the middle
  // cell's mapping stretches.
  const sx = page.getByLabel('scaleX', { exact: true });
  await sx.fill('3');
  await sx.blur();
  const corner = stage.locator('g[data-savig-object*="~0/"]').first();
  const middle = stage.locator('g[data-savig-object*="~4/"]').first();
  await expect(middle).toHaveAttribute('transform', /matrix\(([3-9]|\d{2,})(\.\d+)?, 0, 0, 1,/);
  await expect(corner).toHaveAttribute('transform', /scale\(1, 1\) translate\([^)]*\) translate\([^)]*\) matrix\(1, 0, 0, 1,/);

  // Clicking a cell selects the instance, not a cell.
  await stage.click({ position: { x: 5, y: 5 } });
  await middle.click({ force: true });
  await expect(page.getByTestId('symbol-scale9')).toBeChecked();

  // An inset edit is one undo step.
  const left = page.getByTestId('scale9-left');
  await left.fill('5');
  await left.blur();
  await expect(left).toHaveValue('5');
  await stage.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await instance.first().click({ force: true });
  await expect(page.getByTestId('scale9-left')).not.toHaveValue('5');

  // Inside the symbol, the guides show.
  await instance.first().dblclick({ force: true });
  await expect(stage.getByTestId('scale9-guides')).toBeVisible();
  await expect(stage.getByTestId('scale9-guide-x0')).toBeAttached();
});
