import { test, expect } from '@playwright/test';

test('dragging a path node near another path’s vertex snaps onto it (crosshair guide)', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;

  // Path A (the snap target) — pen: two clicks + a double-click to finish.
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await page.mouse.click(box.x + 400, box.y + 150);
  await page.mouse.click(box.x + 490, box.y + 150);
  await page.mouse.dblclick(box.x + 430, box.y + 230);

  // A stays selected — switch to the Node tool and read A's bottom vertex (node-2) screen position.
  await page.getByRole('button', { name: 'Node', exact: true }).click();
  const aVertex = (await page.getByTestId('node-2').boundingBox())!;
  const av = { x: aVertex.x + aVertex.width / 2, y: aVertex.y + aVertex.height / 2 };

  // Path B (the mover) — pen elsewhere.
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await page.mouse.click(box.x + 120, box.y + 150);
  await page.mouse.click(box.x + 250, box.y + 150);
  await page.mouse.dblclick(box.x + 180, box.y + 230);

  await page.getByRole('button', { name: 'Node', exact: true }).click();
  const bNode = page.getByTestId('node-1');
  const bb = (await bNode.boundingBox())!;

  // Drag B's node-1 to just shy of A's vertex (node drags follow the cursor 1:1 in screen space).
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(av.x + 2, av.y + 2); // within the snap threshold of A's vertex
  // A vertex snap pins BOTH axes → a crosshair (vertical + horizontal guide).
  await expect(page.getByTestId('snap-guide-x')).toBeAttached();
  await expect(page.getByTestId('snap-guide-y')).toBeAttached();
  await page.mouse.up();
  await expect(page.getByTestId('snap-guide-x')).toHaveCount(0); // cleared on release

  const after = (await page.getByTestId('node-1').boundingBox())!;
  const ac = { x: after.x + after.width / 2, y: after.y + after.height / 2 };
  expect(Math.hypot(ac.x - av.x, ac.y - av.y)).toBeLessThan(3); // snapped onto A's vertex
});
