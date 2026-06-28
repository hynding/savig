import { test, expect } from '@playwright/test';

// Helper: suppress native file dialogs (not needed here, but defensive)
const suppressDialogs = async (page: Parameters<typeof test>[1]['page']) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
};

// Helper: draw a rect on the stage and return after the shape is visible.
async function drawRect(
  page: Parameters<typeof test>[1]['page'],
  box: { x: number; y: number },
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  const tools = page.getByRole('group', { name: 'Tools' });
  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + x0, box.y + y0);
  await page.mouse.down();
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.up();
}

test('selected symbol instance shows "Instance overrides" section in Inspector', async ({ page }) => {
  await suppressDialogs(page);
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;

  // Draw a rect and create a symbol from it.
  await drawRect(page, box, 120, 100, 200, 170);
  const objects = page.locator('section[aria-label="Stage"] [data-savig-object]');
  await expect(objects).toHaveCount(1);
  await objects.first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();

  // Click the instance to select it.
  const composite = page.locator('section[aria-label="Stage"] [data-savig-object*="/"]');
  await expect(composite).toHaveCount(1);
  await composite.first().click();

  // Inspector should show "Instance overrides" section header.
  await expect(page.getByText('Instance overrides')).toBeVisible();

  // "freeze first frame" checkbox should be present and unchecked by default.
  const freezeCheckbox = page.getByTestId('instance-freeze');
  await expect(freezeCheckbox).toBeVisible();
  await expect(freezeCheckbox).not.toBeChecked();

  // "tint" checkbox should be present and unchecked by default.
  const tintCheckbox = page.getByTestId('instance-tint-enable');
  await expect(tintCheckbox).toBeVisible();
  await expect(tintCheckbox).not.toBeChecked();
});

test('toggling freeze first frame persists in Inspector', async ({ page }) => {
  await suppressDialogs(page);
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;

  // Draw a rect and create a symbol.
  await drawRect(page, box, 120, 100, 200, 170);
  const objects = page.locator('section[aria-label="Stage"] [data-savig-object]');
  await objects.first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();

  // Click instance.
  const composite = page.locator('section[aria-label="Stage"] [data-savig-object*="/"]');
  await composite.first().click();

  const freezeCheckbox = page.getByTestId('instance-freeze');

  // Toggle on.
  await freezeCheckbox.click();
  await expect(freezeCheckbox).toBeChecked();

  // Toggle off.
  await freezeCheckbox.click();
  await expect(freezeCheckbox).not.toBeChecked();
});

test('enabling tint makes the stage SVG contain a filter element', async ({ page }) => {
  await suppressDialogs(page);
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;

  // Draw a rect and create a symbol.
  await drawRect(page, box, 120, 100, 200, 170);
  const objects = page.locator('section[aria-label="Stage"] [data-savig-object]');
  await objects.first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();

  // Click instance.
  const composite = page.locator('section[aria-label="Stage"] [data-savig-object*="/"]');
  await composite.first().click();

  // Enable tint.
  const tintCheckbox = page.getByTestId('instance-tint-enable');
  await tintCheckbox.click();
  await expect(tintCheckbox).toBeChecked();

  // The stage SVG defs should now contain a savig-tint filter.
  const stageContent = page.locator('section[aria-label="Stage"] svg');
  await expect(stageContent).toContainText('savig-tint', { timeout: 3000 }).catch(async () => {
    // If toContainText doesn't work for SVG, check the SVG source directly.
    const html = await stageContent.innerHTML();
    expect(html).toContain('savig-tint');
  });
});
