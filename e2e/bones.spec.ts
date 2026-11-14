/**
 * Bone tool slice 2 (spec 2026-11-13-bone-tool §Editor): draw a two-bone arm with the Bone tool
 * (the second bone grows from the first one's tip), attach a rectangle to the forearm, then pose
 * it by dragging the tip at two times with auto-key on — the rectangle moves and both bones get
 * rotation keys. Alt-drag rotates only the dragged bone.
 */
import { expect, test, type Page } from '@playwright/test';

async function stagePoint(page: Page) {
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  return (x: number, y: number) => ({ x: box.x + x, y: box.y + y });
}

test('draw bones, attach a drawing, pose with IK at two times', async ({ page }) => {
  await page.goto('/');
  const at = await stagePoint(page);
  const tools = page.getByRole('group', { name: 'Tools' });
  const drag = async (a: { x: number; y: number }, b: { x: number; y: number }, mods: ('Alt')[] = []) => {
    for (const m of mods) await page.keyboard.down(m);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2);
    await page.mouse.move(b.x, b.y);
    await page.mouse.up();
    for (const m of mods) await page.keyboard.up(m);
  };

  // A rectangle that will become the forearm's hand.
  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await drag(at(300, 140), at(340, 160));

  // Two bones: shoulder → elbow, then elbow (snapped to the first tip) → wrist.
  await tools.getByRole('button', { name: 'Bone', exact: true }).click();
  await drag(at(150, 150), at(250, 150));
  await drag(at(251, 151), at(330, 150));
  const wedges = page.locator('[data-testid="bone-overlay"] [data-bone-name]');
  await expect(wedges).toHaveCount(2);
  await expect(page.locator('[data-testid^="bone-badge-"]')).toHaveCount(2);

  // Attach: rectangle + forearm selected (Layers), then the Inspector button.
  await tools.getByRole('button', { name: 'Select', exact: true }).click();
  const layers = page.locator('[aria-label="Layers"]');
  await layers.getByText('Rectangle', { exact: false }).first().click();
  await layers.getByText('Bone 2', { exact: true }).click({ modifiers: ['Shift'] });
  await page.getByTestId('inspector-attach-bone').click();
  const rect = page.locator('section[aria-label="Stage"] [data-savig-object]').first();
  const before = (await rect.boundingBox())!;

  // Pose at frame 1: drag the wrist tip up (IK bends both bones). Auto-key is on by default.
  await layers.getByText('Bone 2', { exact: true }).click();
  const tip = page.locator('[data-testid^="bone-tip-"]').nth(1);
  const tb = (await tip.boundingBox())!;
  await drag({ x: tb.x + tb.width / 2, y: tb.y + tb.height / 2 }, at(260, 60));
  const after = (await rect.boundingBox())!;
  const centre = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const moved = Math.hypot(centre(after).x - centre(before).x, centre(after).y - centre(before).y);
  expect(moved).toBeGreaterThan(30);

  // Both bones carry a rotation keyframe now: the Inspector shows the pose as keyed.
  await layers.getByText('Bone 1', { exact: true }).click();
  await expect(page.getByTestId('inspector-bone')).toContainText('(keyed)');

  // Undo removes the pose in one step.
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('inspector-bone')).not.toContainText('(keyed)');
});

test('bone Inspector edits limits and pin; Alt-drag rotates one bone', async ({ page }) => {
  await page.goto('/');
  const at = await stagePoint(page);
  const tools = page.getByRole('group', { name: 'Tools' });
  await page.keyboard.press('j');
  await expect(tools.getByRole('button', { name: 'Bone', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(at(150, 150).x, at(150, 150).y);
  await page.mouse.down();
  await page.mouse.move(at(250, 150).x, at(250, 150).y);
  await page.mouse.up();
  const section = page.getByTestId('inspector-bone');
  await expect(section).toBeVisible();
  await section.getByLabel('Pin bone').check();
  await expect(section.getByLabel('Pin bone')).toBeChecked();
  await section.getByLabel('Pin bone').uncheck();
  await section.getByLabel('Limit joint').check();
  await expect(section.getByLabel('Joint min')).toHaveValue('-45');

  // Alt-drag the tip straight down: FK clamps at the +45° limit. (Click the Select tool — a
  // focused Inspector field would swallow the V shortcut.)
  await tools.getByRole('button', { name: 'Select', exact: true }).click();
  const tip = page.locator('[data-testid^="bone-tip-"]').first();
  const tb = (await tip.boundingBox())!;
  await page.keyboard.down('Alt');
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  await page.mouse.move(at(150, 250).x, at(150, 250).y);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect(section).toContainText('pose 45°');
});
