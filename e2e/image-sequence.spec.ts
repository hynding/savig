import { test, expect } from '@playwright/test';

// Image-sequence import (spec 2026-11-16-image-sequence): pick numbered pictures, get a frame
// layer with one key per picture in number order; scrubbing flips between them; one undo removes it.
const RED = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==';
const BLUE = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGNgYPgPRmAKABf2A/1+6zfzAAAAAElFTkSuQmCC';

test('import numbered pictures as a frame-by-frame layer', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Import Sequence').setInputFiles([
    { name: 'run10.png', mimeType: 'image/png', buffer: Buffer.from(BLUE, 'base64') },
    { name: 'run2.png', mimeType: 'image/png', buffer: Buffer.from(RED, 'base64') },
    { name: 'run3.png', mimeType: 'image/png', buffer: Buffer.from(BLUE, 'base64') },
  ]);
  await expect(page.getByText('Imported 3 pictures as a frame layer.')).toBeVisible();

  const stage = page.locator('section[aria-label="Stage"]');
  const frames = stage.locator('[data-savig-object]');
  await expect(frames).toHaveCount(3);
  // At the start only the first picture (run2 = red) is exposed.
  const visibleHref = async () =>
    stage.evaluate((el) => {
      const shown = [...el.querySelectorAll('[data-savig-object]')].filter((n) => n.getAttribute('visibility') !== 'hidden');
      return shown.map((n) => n.getAttribute('href') ?? n.querySelector('[href]')?.getAttribute('href') ?? '');
    });
  const first = await visibleHref();
  expect(first).toHaveLength(1);
  await page.keyboard.press('.');
  await page.keyboard.press('.');
  await expect.poll(visibleHref).not.toEqual(first);

  await page.keyboard.press('Control+z');
  await expect(frames).toHaveCount(0);
});
