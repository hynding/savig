import { test, expect } from '@playwright/test';

test('timeline ruler: frame/second tick background + second labels aligned to the time scale', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;

  // Draw a rect, then create a keyframe ~2.5s later so the timeline has real duration.
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 150);
  await page.mouse.up();

  // Two keyframes (one at t=0, one ~2.5s later) give the timeline a real duration span.
  // Auto-key is on by default, so object drags keyframe at the playhead.
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const obj = page.locator('section[aria-label="Stage"] [data-savig-object]').first();
  const dragBy = async (dx: number, dy: number) => {
    const b = (await obj.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy);
    await page.mouse.up();
  };
  await dragBy(20, 5); // keyframe at t=0
  for (let i = 0; i < 76; i++) await page.getByRole('button', { name: 'Step forward', exact: true }).click(); // ~2.5s @30fps
  await dragBy(40, 10); // keyframe at ~2.5s

  const ruler = page.getByTestId('timeline-ruler');

  // Tick background: a layered repeating-linear-gradient (frame + second) at the default 30fps.
  const bg = await ruler.evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(bg).toContain('repeating-linear-gradient');
  expect((bg.match(/repeating-linear-gradient/g) ?? []).length).toBe(2);

  // Second labels exist and read as M:SS.
  await expect(ruler.getByTestId('ruler-second-0')).toHaveText('0:00');
  await expect(ruler.getByTestId('ruler-second-1')).toHaveText('0:01');
  await expect(ruler.getByTestId('ruler-second-2')).toHaveText('0:02');

  // Labels sit on the time scale: the 0:01 label is 100px to the right of 0:00 (PX_PER_SECOND).
  const x0 = (await ruler.getByTestId('ruler-second-0').boundingBox())!.x;
  const x1 = (await ruler.getByTestId('ruler-second-1').boundingBox())!.x;
  expect(x1 - x0).toBeCloseTo(100, 0);
});
