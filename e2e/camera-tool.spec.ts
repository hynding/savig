import { test, expect, type Page } from '@playwright/test';

// Camera tool (spec 2026-11-18-camera-tool): the Stage looks through the camera while the tool is
// on; dragging pans it, the wheel zooms it, and with any other tool a dashed frame shows what the
// camera sees. The Inspector's Camera panel edits and removes it.
async function setup(page: Page) {
  await page.goto('/');
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 180, { steps: 3 });
  await page.mouse.up();
  return box;
}
const rect = (page: Page) => page.locator('section[aria-label="Stage"] [data-savig-object]').first();

test('dragging with the camera tool pans the camera; the frame shows it after switching back', async ({ page }) => {
  const box = await setup(page);
  const before = (await rect(page).boundingBox())!;
  await page.keyboard.press('a');
  await expect(page.getByRole('button', { name: 'Camera', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('camera-view')).toHaveCount(1);
  await expect(page.getByTestId('inspector-camera')).toBeVisible();

  // Drag the picture 60px right: the drawing follows the pointer.
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 360, box.y + 300, { steps: 4 });
  await page.mouse.up();
  const after = (await rect(page).boundingBox())!;
  expect(after.x - before.x).toBeGreaterThan(40);
  expect(Math.abs(after.y - before.y)).toBeLessThan(3);
  await expect(page.getByTestId('inspector-camera-x')).not.toHaveValue('');

  // Another tool: the world view comes back and the dashed camera frame shows where it looks.
  await page.keyboard.press('v');
  await expect(page.getByTestId('camera-view')).toHaveCount(0);
  await expect(page.getByTestId('camera-frame')).toHaveCount(1);
  const back = (await rect(page).boundingBox())!;
  expect(Math.abs(back.x - before.x)).toBeLessThan(2);

  // Undo removes the camera move (the camera itself was seeded in the same step).
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('camera-frame')).toHaveCount(0);
});

test('the wheel zooms the camera and the Camera panel removes it', async ({ page }) => {
  const box = await setup(page);
  const before = (await rect(page).boundingBox())!;
  await page.getByRole('button', { name: 'Camera', exact: true }).click();
  await page.mouse.move(box.x + 300, box.y + 200);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await rect(page).boundingBox())!.width).toBeGreaterThan(before.width * 1.2);
  // The zoom settles into the document: the panel shows it in percent.
  await expect.poll(async () => Number(await page.getByTestId('inspector-camera-zoom').inputValue())).toBeGreaterThan(120);
  await page.getByTestId('inspector-remove-camera').click();
  await expect(page.getByTestId('inspector-add-camera')).toBeVisible();
  const reset = (await rect(page).boundingBox())!;
  expect(Math.abs(reset.width - before.width)).toBeLessThan(2);
});

test('camera keys show on a Camera timeline row; dragging retimes and Delete removes them', async ({ page }) => {
  await setup(page);
  // Auto-key on: two zoom keys from the Camera panel, at 0 s and 1 s.
  await page.keyboard.press('a');
  const autoKey = page.getByRole('button', { name: 'Auto-key' });
  if ((await autoKey.getAttribute('aria-pressed')) !== 'true') await autoKey.click();
  await page.getByTestId('inspector-add-camera').click();
  await page.getByTestId('inspector-camera-zoom').fill('120');
  await page.getByTestId('inspector-camera-zoom').press('Enter');
  await page.getByTestId('timeline-ruler').click({ position: { x: 100, y: 5 } }); // 1 s
  await page.getByTestId('inspector-camera-zoom').fill('150');
  await page.getByTestId('inspector-camera-zoom').press('Enter');

  const row = page.getByTestId('track-row-camera');
  await expect(row).toBeVisible();
  await expect(row.locator('[data-testid^="camera-keyframe-zoom-"]')).toHaveCount(2);

  // Drag the 1 s key half a second right: it is selected and retimed.
  const key = page.getByTestId('camera-keyframe-zoom-1');
  const kb = (await key.boundingBox())!;
  await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2);
  await page.mouse.down();
  await page.mouse.move(kb.x + kb.width / 2 + 50, kb.y + kb.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId('camera-keyframe-zoom-1')).toHaveCount(0);
  await expect(page.getByTestId('inspector-camera-selected-key')).toBeVisible();
  await page.getByLabel('Camera key easing').selectOption('easeOut');
  await expect(page.getByLabel('Camera key easing')).toHaveValue('easeOut');

  await page.keyboard.press('Delete');
  await expect(row.locator('[data-testid^="camera-keyframe-zoom-"]')).toHaveCount(1);
});

test('camera shake from the Camera panel badges the Camera row', async ({ page }) => {
  await setup(page);
  await page.keyboard.press('a');
  await page.getByTestId('inspector-add-camera').click();
  await page.getByLabel('Camera X wiggle', { exact: true }).check();
  await expect(page.getByTestId('modifier-badge-camera')).toBeVisible();
  await expect(page.getByLabel('Camera X wiggle amount')).toHaveValue('8');
  await page.getByLabel('Camera Rotation loop').selectOption('pingpong');
  await expect(page.getByTestId('modifier-badge-camera')).toHaveAttribute('title', /Rotation ping-pong/);
});
