import { test, expect } from '@playwright/test';

// Width tool (spec 2026-11-18-variable-width, slice 2): drag sideways on a stroke to swell it
// there; Alt-click a station to remove it; the Inspector's width profile presets; undo.
test('Width tool swells a stroke, a station comes off with Alt-click, presets apply and undo', async ({ page }) => {
  await page.goto('/');
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await page.mouse.move(box.x + 80, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, box.y + 202, { steps: 4 });
  await page.mouse.up();

  const shape = page.locator('section[aria-label="Stage"] [data-savig-object]').first();
  const outline = shape.locator('[data-savig-width]');
  await expect(outline).toHaveCount(0);

  await page.keyboard.press('w');
  await expect(page.getByRole('button', { name: 'Width', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('width-tool')).toBeVisible();
  const before = (await shape.boundingBox())!;

  // Drag from the middle of the line straight down: the stroke's edge follows the pointer there.
  const mx = box.x + 200;
  const my = box.y + 201;
  await page.mouse.move(mx, my);
  await page.mouse.down();
  await page.mouse.move(mx, my + 6, { steps: 3 });
  await page.mouse.move(mx, my + 12, { steps: 3 });
  await expect(page.getByTestId('width-preview')).toHaveCount(1);
  await page.mouse.up();

  await expect(outline).toHaveCount(1);
  await expect(page.getByTestId('width-station-1')).toBeVisible();
  await expect(page.getByTestId('width-station-3')).toHaveCount(0);
  const swollen = (await shape.boundingBox())!;
  expect(swollen.height).toBeGreaterThan(before.height + 15); // ±12 px at the middle
  await expect(page.getByLabel('width profile')).toHaveValue('custom');

  // Alt-click the middle station: back to a uniform stroke.
  await page.getByTestId('width-station-1').click({ modifiers: ['Alt'] });
  await expect(outline).toHaveCount(0);
  await expect(page.getByLabel('width profile')).toHaveValue('uniform');

  // Inspector preset.
  await page.getByLabel('width profile').selectOption('taper-end');
  await expect(outline).toHaveCount(1);
  await expect(page.getByTestId('width-station-1')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(outline).toHaveCount(0);
});
