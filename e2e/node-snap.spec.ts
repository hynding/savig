import { test, expect } from '@playwright/test';

test('dragging a path node near another object snaps it to that edge + shows a guide', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;

  // Draw rect T (the snap target) on the right; its LEFT edge is the snap line.
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 400, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 470, box.y + 300);
  await page.mouse.up();

  // Author a path (pen) to the left of T: two clicks + a double-click to finish.
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await page.mouse.click(box.x + 100, box.y + 120);
  await page.mouse.click(box.x + 200, box.y + 160);
  await page.mouse.dblclick(box.x + 140, box.y + 240);

  await expect(page.locator('section[aria-label="Stage"] [data-savig-object]')).toHaveCount(2);
  const t = page.locator('section[aria-label="Stage"] [data-savig-object]').nth(0);
  const tBox = (await t.boundingBox())!; // T's left edge = tBox.x (screen)

  // Switch to the Node tool — the just-drawn path stays selected, so its node overlay appears.
  await page.getByRole('button', { name: 'Node', exact: true }).click();
  const node = page.getByTestId('node-1');
  await expect(node).toBeVisible();
  const nb = (await node.boundingBox())!;

  // Drag the node toward T's left edge; aligning the mouse to T's measured screen x maps (same CTM)
  // to T's content-x, so the node lands within the 6px snap threshold.
  await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tBox.x, nb.y + 4);
  await expect(page.getByTestId('snap-guide-x')).toBeAttached(); // guide visible mid-drag
  await page.mouse.up();
  await expect(page.getByTestId('snap-guide-x')).toHaveCount(0); // cleared on release

  const after = (await page.getByTestId('node-1').boundingBox())!;
  expect(Math.abs(after.x + after.width / 2 - tBox.x)).toBeLessThan(3); // node snapped onto T's left edge
});
