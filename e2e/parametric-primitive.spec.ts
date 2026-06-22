import { test, expect } from '@playwright/test';

test("re-editing a stamped star's points regenerates the path in place", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Stamp a star (center-out drag).
  await page.getByRole('button', { name: 'Star', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const cx = box.x + 160;
  const cy = box.y + 160;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 80);
  await page.mouse.up();
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object]')).toHaveCount(1);

  const pathLoc = page.locator('[data-savig-object] path').first();
  const dBefore = (await pathLoc.getAttribute('d'))!;
  const cBefore = (await pathLoc.boundingBox())!;
  const countL = (d: string) => (d.match(/L/g) ?? []).length;

  // The Inspector exposes the parametric params; bump Points 5 -> 9.
  const points = page.getByLabel('Points');
  await expect(points).toHaveValue('5');
  await points.fill('9');
  await points.blur();

  const dAfter = (await pathLoc.getAttribute('d'))!;
  const cAfter = (await pathLoc.boundingBox())!;

  expect(dAfter).not.toBe(dBefore);
  expect(countL(dAfter)).toBeGreaterThan(countL(dBefore)); // more vertices (9-point > 5-point)
  // Regenerated about the same circumcentre/radius — the star is left-right symmetric
  // (bbox centre-x = centre) and its top vertex points straight up (bbox top = centre-r),
  // so both stay put across the point-count change. (The bbox *centre-y* legitimately
  // shifts a few px because a star's silhouette isn't vertically symmetric.)
  expect(Math.abs(cAfter.x + cAfter.width / 2 - (cBefore.x + cBefore.width / 2))).toBeLessThan(3);
  expect(Math.abs(cAfter.y - cBefore.y)).toBeLessThan(3);
});
