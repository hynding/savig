import { test, expect, type Page } from '@playwright/test';

/** History panel (roadmap 13): every edit is a named row; clicking an older row jumps back in one
 *  step, later rows stay redoable, and a new edit replaces them. */
async function drawRect(page: Page, x: number, y: number) {
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const box = (await page.locator('section[aria-label="Stage"] svg').first().boundingBox())!;
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 80, box.y + y + 60);
  await page.mouse.up();
}

test('the History panel names steps and jumps between them', async ({ page }) => {
  await page.goto('/');
  const panel = page.getByTestId('history-panel');
  const rects = page.locator('section[aria-label="Stage"] [data-savig-object] rect');

  await panel.getByTestId('history-toggle').click();
  await expect(panel.getByTestId('history-row-0')).toHaveText('New document');

  await drawRect(page, 40, 40);
  await drawRect(page, 200, 40);
  await drawRect(page, 40, 160);
  await expect(rects).toHaveCount(3);
  await expect(panel.getByTestId('history-row-1')).toHaveText('Draw rect');
  await expect(panel.getByTestId('history-row-3')).toHaveAttribute('data-state', 'current');

  // Jump two steps back in one click; the later steps stay listed as redoable.
  await panel.getByTestId('history-row-1').click();
  await expect(rects).toHaveCount(1);
  await expect(panel.getByTestId('history-row-3')).toHaveAttribute('data-state', 'future');

  // Jump forward again, then undo with the keyboard: the panel follows.
  await panel.getByTestId('history-row-3').click();
  await expect(rects).toHaveCount(3);
  await page.locator('section[aria-label="Stage"]').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(rects).toHaveCount(2);
  await expect(panel.getByTestId('history-row-2')).toHaveAttribute('aria-current', 'step');

  // A new edit after going back replaces the redo branch.
  await panel.getByTestId('history-row-1').click();
  await drawRect(page, 300, 200);
  await expect(panel.getByTestId('history-row-3')).toHaveCount(0);
  await expect(panel.getByTestId('history-row-2')).toHaveAttribute('data-state', 'current');
  await expect(panel.getByTestId('history-redo')).toBeDisabled();
});

test('the History panel opens from the command palette', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('history-row-0')).toHaveCount(0);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('history panel');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('history-row-0')).toHaveText('New document');
});
