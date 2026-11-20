import { test, expect } from '@playwright/test';

/** The toolbar must stay one row with no scrollbar at the default 1280 px width: a toolbar
 *  scrollbar makes the row taller, shrinks the Stage and breaks pointer-precise specs (snapping). */
test('the toolbar fits on one row at 1280 px', async ({ page }) => {
  await page.goto('/');
  const fit = await page.evaluate(() => {
    const t = document.querySelector('section[aria-label="Toolbar"]') as HTMLElement;
    return { scroll: t.scrollWidth, client: t.clientWidth };
  });
  expect(fit.scroll).toBeLessThanOrEqual(fit.client);
});
