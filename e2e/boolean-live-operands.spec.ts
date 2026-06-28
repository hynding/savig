import { test, expect } from '@playwright/test';

test('live boolean operands ghost on canvas and re-clip when nudged', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const stage = page.locator('section[aria-label="Stage"]');
  const svg = stage.locator('svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });

  const drawRect = async (x0: number, y0: number, x1: number, y1: number) => {
    await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.up();
  };

  // Two overlapping rects.
  await drawRect(120, 120, 280, 280);
  await drawRect(220, 120, 380, 280);

  const objects = stage.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2);

  // Select both, then Alt+Union -> a LIVE boolean (operands kept but render-hidden -> 1 drawn).
  await objects.nth(0).click({ position: { x: 8, y: 8 } });
  await objects.nth(1).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Union', exact: true }).click({ modifiers: ['Alt'] });
  await expect(objects).toHaveCount(1); // operands consumed; the live result draws

  // The live boolean is selected on create -> its operand ghosts are on canvas.
  const ghosts = stage.locator('[data-testid^="operand-ghost-"]');
  await expect(ghosts).toHaveCount(2);

  // Record the live result's bbox, then select an operand via its ghost and nudge it.
  const before = (await objects.first().boundingBox())!;
  await ghosts.first().click();
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');

  // The boolean re-clipped: its rendered result moved/grew with the operand.
  const after = (await objects.first().boundingBox())!;
  expect(Math.abs(after.x - before.x) + Math.abs(after.width - before.width)).toBeGreaterThan(1);
});
