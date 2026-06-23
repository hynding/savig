import { test, expect } from '@playwright/test';

// Slice 45d: with auto-key on, transforming a group at different playhead times keyframes
// the GROUP — and its children animate with it (the group transform composes per frame).
test('animate a group as a unit: two keyframes move both children over time', async ({ page }) => {
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

  await drawRect(120, 200, 170, 250); // A
  await drawRect(220, 200, 270, 250); // B

  const objects = page.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2);
  const a = objects.nth(0);
  const b = objects.nth(1);

  // Group them (auto-key is on by default; the group is selected after grouping).
  await a.click();
  await b.click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Group', exact: true }).click();

  const dragGroup = async (dx: number) => {
    const ab = (await a.boundingBox())!;
    const c = { x: ab.x + ab.width / 2, y: ab.y + ab.height / 2 };
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + dx, c.y);
    await page.mouse.up();
  };

  // Keyframe the group's position at t0, then scrub forward and move it again -> 2 keyframes.
  await page.getByTestId('timeline-ruler').click({ position: { x: 0, y: 5 } });
  await dragGroup(40);
  const groupRow = page.locator('[data-testid^="track-row-"]').filter({ has: page.locator('[data-testid*="-x-"]') });
  await page.getByTestId('timeline-ruler').click({ position: { x: 160, y: 5 } });
  await dragGroup(80);
  // The group's x track now has >= 2 keyframe diamonds (it animates).
  await expect(groupRow.locator('[data-testid*="-x-"]')).toHaveCount(2);

  // Scrub to the start vs the later time -> a child sits at two different x positions.
  await page.getByTestId('timeline-ruler').click({ position: { x: 0, y: 5 } });
  const early = (await a.boundingBox())!.x;
  await page.getByTestId('timeline-ruler').click({ position: { x: 160, y: 5 } });
  const late = (await a.boundingBox())!.x;
  expect(late - early).toBeGreaterThan(20); // the child moved with the animated group
});
