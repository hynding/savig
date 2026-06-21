import { test, expect } from '@playwright/test';

test('select a keyframe -> set easeIn -> readback reflects it and survives reload', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Author a path with the pen, then key x at two times so there is a keyframe.
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.click(box.x + 80, box.y + 80);
  await page.mouse.click(box.x + 180, box.y + 120);
  await page.mouse.dblclick(box.x + 240, box.y + 80);

  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const xField = page.getByLabel('x', { exact: true });
  await expect(xField).toBeEnabled();
  await xField.fill('100');
  await xField.blur();
  await page.getByTestId('timeline-ruler').click({ position: { x: 100, y: 10 } });
  await xField.fill('400');
  await xField.blur();

  // Select the first x keyframe diamond in the timeline (testid: keyframe-{id}-x-{time}).
  const firstDiamond = page.locator('[data-testid^="keyframe-"][data-testid*="-x-"]').first();
  await firstDiamond.click();

  // The Inspector Keyframe section appears; set easeIn and check the read-back.
  await page.getByRole('button', { name: 'easeIn', exact: true }).click();
  await expect(page.getByTestId('easing-readback')).toHaveText('easeIn');

  // Reload: IndexedDB autosave (1s debounce) should restore the project; the easing
  // persists. Wait past the debounce so the latest state is flushed before reloading.
  await page.waitForTimeout(1300);
  await page.reload();
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.locator('[data-testid^="keyframe-"][data-testid*="-x-"]').first().click();
  await expect(page.getByTestId('easing-readback')).toHaveText('easeIn');
});
