import { test, expect } from '@playwright/test';

test('animating a star\'s Points via the Inspector keyframes the primitive param track', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Stamp a star (center-out drag), same gesture as parametric-primitive.spec.ts.
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

  // Auto-key is ON by default — leave it untouched.
  await expect(page.getByRole('button', { name: 'Auto-key' })).toHaveAttribute('aria-pressed', 'true');

  const pathLoc = page.locator('section[aria-label="Stage"] [data-savig-object] path').first();
  const countSegments = (d: string) => (d.match(/[LC]/g) ?? []).length;

  // At t=0 (playhead starts at 0), commit Points = 4 -> keyframes obj.tracks.starPoints @ t=0.
  // NumberField.commit() only calls onCommit when the typed value differs from the field's
  // current (displayed) value (Inspector.tsx: `if (n !== value) onCommit(n);`), so re-committing
  // the star's already-default 5 would silently no-op and never create the t=0 keyframe — hence 4.
  const points = page.getByLabel('Points', { exact: true });
  await expect(points).toHaveValue('5');
  await points.fill('4');
  await points.blur();
  const dAtT0 = (await pathLoc.getAttribute('d'))!;

  // Move the playhead along the ruler, then commit Points = 9 -> a second keyframe.
  await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } });
  await points.fill('9');
  await points.blur();
  const dAtT2 = (await pathLoc.getAttribute('d'))!;

  expect(dAtT2).not.toBe(dAtT0);
  expect(countSegments(dAtT2)).toBeGreaterThan(countSegments(dAtT0)); // 9-point star has more path segments than 4-point

  // A scalar keyframe diamond exists for the starPoints track (Timeline.tsx:
  // data-testid={`keyframe-${row.id}-${track.property}-${kf.time}`}).
  const diamonds = page.locator('[data-testid*="-starPoints-"]');
  await expect(diamonds).toHaveCount(2);
});
