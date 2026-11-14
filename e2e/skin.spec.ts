/**
 * Bone skinning slice 2 (spec 2026-11-14-bone-skinning §Editor): draw a long bar and a two-bone
 * armature along it, bind the bar to the bones (one selected bone = the whole armature), then
 * drag the tip — the bar BENDS (its outline changes) instead of moving rigidly. Undo unbinds.
 */
import { expect, test, type Page } from '@playwright/test';

async function stagePoint(page: Page) {
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  return (x: number, y: number) => ({ x: box.x + x, y: box.y + y });
}

test('bind a bar to an armature and bend it by dragging the tip', async ({ page }) => {
  await page.goto('/');
  const at = await stagePoint(page);
  const tools = page.getByRole('group', { name: 'Tools' });
  const drag = async (a: { x: number; y: number }, b: { x: number; y: number }) => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2);
    await page.mouse.move(b.x, b.y);
    await page.mouse.up();
  };

  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await drag(at(150, 140), at(330, 160));
  await tools.getByRole('button', { name: 'Bone', exact: true }).click();
  await drag(at(150, 150), at(240, 150));
  await drag(at(241, 151), at(330, 150));
  await expect(page.locator('[data-testid="bone-overlay"] [data-bone-name]')).toHaveCount(2);

  // Rectangle + one bone selected → Bind to Bones takes the whole armature.
  await tools.getByRole('button', { name: 'Select', exact: true }).click();
  const layers = page.locator('[aria-label="Layers"]');
  await layers.getByText('Rectangle', { exact: false }).first().click();
  await layers.getByText('Bone 1', { exact: true }).click({ modifiers: ['Shift'] });
  await page.getByTestId('inspector-bind-skin').click();
  await expect(page.locator('[data-testid^="skin-badge-"]')).toHaveCount(1);
  await expect(page.getByTestId('inspector-skin')).toContainText('2 bones');

  const bar = page.locator('section[aria-label="Stage"] [data-savig-object] path').first();
  const before = await bar.getAttribute('d');
  const box0 = (await bar.boundingBox())!;

  // Pose: drag the wrist tip up — the bar bends (taller bounding box, new outline).
  await layers.getByText('Bone 2', { exact: true }).click();
  const tip = page.locator('[data-testid^="bone-tip-"]').nth(1);
  const tb = (await tip.boundingBox())!;
  await drag({ x: tb.x + tb.width / 2, y: tb.y + tb.height / 2 }, at(260, 70));
  await expect.poll(async () => bar.getAttribute('d')).not.toBe(before);
  const box1 = (await bar.boundingBox())!;
  expect(box1.height).toBeGreaterThan(box0.height + 30);

  // Undo the pose, then the bind.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => bar.getAttribute('d')).toBe(before);
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-testid^="skin-badge-"]')).toHaveCount(0);
});
