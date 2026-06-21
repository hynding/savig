import { test, expect } from '@playwright/test';

test('To Back moves the selected object below the others', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw two rects (the 2nd is selected and on top = last in DOM).
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const rectTool = page
    .getByRole('group', { name: 'Tools' })
    .getByRole('button', { name: 'Rectangle', exact: true });
  for (const [dx, dy] of [
    [60, 60],
    [200, 160],
  ]) {
    await rectTool.click();
    await page.mouse.move(box.x + dx, box.y + dy);
    await page.mouse.down();
    await page.mouse.move(box.x + dx + 80, box.y + dy + 60);
    await page.mouse.up();
  }
  await page.getByRole('button', { name: 'Select' }).click();
  await expect(page.locator('[data-savig-object]')).toHaveCount(2);

  const idsBefore = await page
    .locator('[data-savig-object]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-savig-object')));

  // The 2nd rect (last in DOM = front) is selected; send it to the back.
  await page.getByRole('button', { name: /to back/i }).click();

  const idsAfter = await page
    .locator('[data-savig-object]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-savig-object')));
  // The front object (last before) is now first (back).
  expect(idsAfter[0]).toBe(idsBefore[1]);
  expect(idsAfter).toEqual([...idsBefore].reverse());
});
