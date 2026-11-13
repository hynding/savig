import { test, expect } from '@playwright/test';

// Filters slice 2 (spec 2026-11-13-filters): add a drop shadow from the Inspector, edit a param
// (auto-key puts a keyframe on the Timeline), disable/enable, reorder with a second filter,
// add one from the command palette, remove, and undo.
test('add, edit, keyframe, toggle, reorder and remove filters', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 100, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 240);
  await page.mouse.up();
  const id = (await page.locator('[data-savig-object]').first().getAttribute('data-savig-object'))!;

  // Add a drop shadow: a <filter> def + a wrapper around the object on the Stage.
  await page.getByTestId('inspector-add-filter').selectOption('dropShadow');
  const def = page.locator(`filter[id="savig-filter-${id}"]`);
  await expect(def.locator('feDropShadow')).toHaveCount(1);
  await expect(page.locator(`[data-testid="filter-group-savig-filter-${id}"] [data-savig-object="${id}"]`)).toHaveCount(1);

  // Edit dx (auto-key on by default): the primitive updates and a filter keyframe appears.
  const dx = page.getByLabel('Drop shadow dx');
  await dx.fill('20');
  await dx.press('Enter');
  await expect(def.locator('feDropShadow')).toHaveAttribute('dx', '20');
  await expect(page.locator(`[data-testid^="filter-keyframe-"][data-testid$="-${id}-0"]`)).toHaveCount(1);

  // Disable → no wrapper; enable → back.
  await page.getByLabel('Drop shadow enabled').uncheck();
  await expect(page.locator(`[data-testid="filter-group-savig-filter-${id}"]`)).toHaveCount(0);
  await page.getByLabel('Drop shadow enabled').check();
  await expect(page.locator(`[data-testid="filter-group-savig-filter-${id}"]`)).toHaveCount(1);

  // Add a glow from the command palette, then move it above the shadow.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByLabel('Command search').fill('add glow');
  await palette.getByLabel('Command search').press('Enter');
  await expect(page.getByTestId('filter-card-1')).toHaveAttribute('data-filter-kind', 'glow');
  await page.getByLabel('move Glow up').click();
  await expect(page.getByTestId('filter-card-0')).toHaveAttribute('data-filter-kind', 'glow');
  await expect(def.locator(':scope > *').first()).toHaveJSProperty('tagName', 'feGaussianBlur');

  // Remove the glow; undo brings it back.
  await page.getByLabel('remove Glow').click();
  await expect(page.getByTestId('filter-card-1')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('filter-card-1')).toHaveCount(1);
});
