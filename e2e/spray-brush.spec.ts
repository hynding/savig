import { test, expect } from '@playwright/test';

/** Spray brush (roadmap 12): spray dots along a stroke (one group, one undo step), then spray
 *  copies of a symbol. */
test('spray dots and symbol copies along a stroke', async ({ page }) => {
  await page.goto('/');
  const stage = page.locator('section[aria-label="Stage"]');
  const box = (await stage.locator('svg').first().boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });

  await tools.getByRole('button', { name: 'Spray Brush', exact: true }).click();
  const opts = page.getByRole('group', { name: 'Spray brush options' });
  await opts.getByLabel('Spray density').fill('4');
  await opts.getByLabel('Spray radius').fill('20');
  await opts.getByLabel('Spray color').fill('#cc2200');

  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await expect(stage.getByTestId('spray-preview').locator('circle')).toHaveCount(4);
  await page.mouse.move(box.x + 180, box.y + 100, { steps: 6 });
  await page.mouse.up();
  await expect(stage.getByTestId('spray-preview')).toHaveAttribute('visibility', 'hidden');

  const layers = page.locator('[aria-label="Layers"]');
  await expect(layers.getByText('Spray', { exact: true })).toBeVisible();
  const dots = stage.locator('[data-savig-object] ellipse[fill="#cc2200"]');
  const n = await dots.count();
  expect(n).toBeGreaterThanOrEqual(8);

  // Undo removes the whole stroke at once.
  await page.keyboard.press('Control+z');
  await expect(dots).toHaveCount(0);

  // Make a symbol from a rectangle, then spray copies of it.
  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 300, box.y + 250);
  await page.mouse.down();
  await page.mouse.move(box.x + 330, box.y + 280);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();

  await tools.getByRole('button', { name: 'Spray Brush', exact: true }).click();
  const symbolSelect = opts.getByLabel('Spray symbol');
  const symId = await symbolSelect.locator('option').nth(1).getAttribute('value');
  await symbolSelect.selectOption(symId!);
  await opts.getByLabel('Spray density').fill('3');
  await page.mouse.click(box.x + 150, box.y + 400);
  await expect(layers.getByText('Spray', { exact: true })).toBeVisible();
  // The original instance plus three sprayed copies.
  await expect(stage.locator('[data-savig-object] rect')).toHaveCount(4);
});
