import { test, expect } from '@playwright/test';

// Blend modes (spec 2026-11-15-blend-modes): the Inspector's Blend dropdown wraps the object in a
// mix-blend-mode group on the Stage, and it survives into the exported SVG.
test('choosing Multiply in the Inspector blends the shape on the Stage; Normal removes it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 140);
  await page.mouse.up();

  const blend = page.getByLabel('Blend mode');
  await expect(blend).toHaveValue('normal');
  await blend.selectOption('multiply');
  const group = page.locator('section[aria-label="Stage"] [data-testid^="blend-group-"]');
  await expect(group).toHaveCount(1);
  await expect(group).toHaveCSS('mix-blend-mode', 'multiply');
  await expect(group.locator('[data-savig-object]')).toHaveCount(1);

  await blend.selectOption('normal');
  await expect(group).toHaveCount(0);
});
