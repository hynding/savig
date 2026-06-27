import { test, expect } from '@playwright/test';

test('boolean-union a GROUP with another shape — the group acts as one operand', async ({ page }) => {
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

  await drawRect(100, 100, 160, 160); // A
  await drawRect(250, 100, 310, 160); // B
  await drawRect(400, 100, 460, 160); // C  (all disjoint so each draws on clear background)

  const objects = page.locator('section[aria-label="Stage"] [data-savig-object]');
  await expect(objects).toHaveCount(3);
  const a = objects.nth(0);
  const c = objects.nth(2);

  // Group A + B.
  await a.click();
  await objects.nth(1).click({ modifiers: ['Shift'] });
  await expect(page.getByText(/2 objects selected/i)).toBeVisible();
  await page.getByRole('button', { name: 'Group', exact: true }).click();

  // Select the GROUP (by clicking a member) + C, then Union.
  await a.click();
  await c.click({ modifiers: ['Shift'] });
  await expect(page.getByText(/2 objects selected/i)).toBeVisible();
  const union = page.getByRole('button', { name: 'Union', exact: true });
  await expect(union).toBeEnabled();
  await union.click();

  // The group (its two leaves) + C are all consumed into a single result path.
  await expect(objects).toHaveCount(1);
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object] path')).toHaveCount(1);
});
