import { test, expect } from '@playwright/test';

test('snap-to-grid: the grid renders when enabled and a move drag lands on the lattice', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;

  // Draw a rect.
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 230, box.y + 210);
  await page.mouse.up();

  // Isolate grid snapping: turn object-snap OFF, grid ON.
  await page.getByRole('button', { name: 'Snap', exact: true }).click(); // snap defaults on → off
  await page.getByRole('button', { name: 'Grid', exact: true }).click(); // grid on
  await expect(page.getByTestId('grid-overlay')).toBeVisible();
  const gridSize = Number(await page.getByLabel('Grid size').inputValue());
  expect(gridSize).toBeGreaterThan(0);

  // Drag the rect; on release its top-left (the leading translate) must land on the grid.
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const obj = page.locator('section[aria-label="Stage"] [data-savig-object]').first();
  const b = (await obj.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 37, b.y + b.height / 2 + 41); // off-grid amount
  await page.mouse.up();

  const transform = (await obj.getAttribute('transform'))!;
  const m = transform.match(/^translate\(([-\d.]+), ([-\d.]+)\)/);
  expect(m).not.toBeNull();
  const x = parseFloat(m![1]);
  const y = parseFloat(m![2]);
  const offGrid = (v: number) => Math.abs(v - Math.round(v / gridSize) * gridSize);
  expect(offGrid(x)).toBeLessThan(0.01); // x landed on a grid line
  expect(offGrid(y)).toBeLessThan(0.01); // y landed on a grid line
});
