import { test, expect } from '@playwright/test';

test('command palette runs a command; shortcuts sheet opens', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const drawRect = async (x1: number, y1: number, x2: number, y2: number) => {
    await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.down();
    await page.mouse.move(box.x + x2, box.y + y2);
    await page.mouse.up();
  };

  // Two disjoint rectangles.
  await drawRect(100, 100, 150, 150);
  await drawRect(200, 100, 250, 150);

  // Select both (select tool, click one, shift-click the other).
  await page.keyboard.press('v');
  await page.mouse.click(box.x + 225, box.y + 125);
  await page.keyboard.down('Shift');
  await page.mouse.click(box.x + 125, box.y + 125);
  await page.keyboard.up('Shift');

  // Open the command palette and run Union.
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await palette.getByLabel('Command search').fill('union');
  await palette.getByLabel('Command search').press('Enter');

  // The two operands collapse into a single boolean path object, and the palette closes.
  await expect(palette).toBeHidden();
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object] path')).toHaveCount(1);

  // The shortcuts sheet opens from the "?" button and lists a known binding.
  await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Undo')).toBeVisible();

  // While the sheet is open the global keymap is suppressed: a stray Delete must NOT delete the
  // selected object behind the modal.
  await page.keyboard.press('Delete');
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object] path')).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});
