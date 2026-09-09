/**
 * Frogger demo — full user-journey e2e over the shipped example project
 * (apps/react/public/frogger/): open the .savig through the real Open flow, inspect and
 * live-edit its interactions in the Inspector, play it in interactive preview (move,
 * collide, reset, win), leave preview cleanly, and drive the standalone exported bundle.
 * The project's collision guards use the xOf('carN') built-in, so this spec also
 * end-to-end-covers sampled-position reads in both the editor session and the bundle.
 * Idioms: showOpenFilePicker stub from open-svg-roundtrip.spec.ts; Stage queries scoped to
 * section[aria-label="Stage"] (AssetPanel emits data-savig-object too).
 */
import { expect, test, type Page } from '@playwright/test';

const stage = (page: Page) => page.locator('section[aria-label="Stage"]');
const frog = (page: Page) => stage(page).locator('[data-savig-object="frog"]');
const statusText = (page: Page) => stage(page).locator('[data-savig-object="status"]');

/** Fetch the served .savig and stub the native picker to hand it to the Open button. */
async function openFrogger(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { confirm: () => boolean }).confirm = () => true;
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const res = await fetch('/frogger/frogger.savig');
    const bytes = new Uint8Array(await res.arrayBuffer());
    const file = new File([bytes], 'frogger.savig', { type: 'application/zip' });
    (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker = async () => [
      { getFile: async () => file },
    ];
  });
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(frog(page)).toHaveCount(1);
}

test('opens via the real Open flow and shows the full interaction model in the Inspector', async ({ page }) => {
  await openFrogger(page);

  // 19 authored objects land on the Stage.
  await expect(stage(page).locator('[data-savig-object]')).toHaveCount(19);

  // Nothing selected -> the Inspector's Interactions panel lists all 4 variables and
  // all 6 global handlers of the game.
  for (const name of ['px', 'py', 'dead', 'won']) {
    await expect(page.getByTestId(`variable-name-${name}`)).toBeVisible();
  }
  await expect(page.locator('[data-testid^="behavior-event-"]')).toHaveCount(6);

  // Selecting the frog swaps to the object view (its Behaviors section is empty — this
  // game keeps everything project-level) and shows editable position fields.
  await frog(page).click();
  await expect(page.getByTestId('add-behavior')).toBeVisible();
});

test('expression fields live-validate through the real parser', async ({ page }) => {
  await openFrogger(page);

  // Find the tick-handler collision guard (the one reading xOf) among the guard inputs —
  // handlers render in authored order, so the movement guards come first.
  const guards = page.locator('[data-testid^="action-if-"]');
  await expect(guards.first()).toBeVisible();
  const count = await guards.count();
  let guard = guards.first();
  let original = '';
  for (let i = 0; i < count; i++) {
    const v = await guards.nth(i).inputValue();
    if (v.includes("xOf('car1')")) {
      guard = guards.nth(i);
      original = v;
      break;
    }
  }
  expect(original).toContain("xOf('car1')");

  const behaviorErrors = page.locator('[data-testid^="expr-error-"]');
  await expect(behaviorErrors).toHaveCount(0);

  // Typing an invalid expression surfaces an inline parse error (message@pos)…
  await guard.fill('1 +');
  await expect(behaviorErrors.first()).toBeVisible();
  await expect(behaviorErrors.first()).toHaveText(/@\d+$/); // "message@pos" format

  // …and restoring the original clears it. Blur commits the (unchanged) value.
  await guard.fill(original);
  await expect(behaviorErrors).toHaveCount(0);
  await guard.blur();
  await expect(guard).toHaveValue(original);
});

test('interactive preview: move, collide (xOf guards), reset, and win', async ({ page }) => {
  test.slow(); // includes a real 4s traffic loop + a retry dash
  await openFrogger(page);

  await page.getByTestId('preview-toggle').click();
  await expect(page.getByTestId('preview-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Play', exact: true }).click();

  // Papercut fix regression proof: Play just stole focus onto its button, and the preview's key
  // listeners are now WINDOW-scoped — the very next arrow must work with NO canvas re-click.
  // Move: ArrowUp applies the variable-driven translate override.
  await page.keyboard.press('ArrowUp');
  await expect(frog(page)).toHaveAttribute('transform', /translate\(0 -80\)/);

  // Collide: sitting in lane 1, the xOf('car1') guard kills within one 4s loop.
  await expect(statusText(page)).toContainText('SPLAT', { timeout: 6000 });
  await expect(frog(page)).toHaveAttribute('display', 'none');

  // Reset restores the frog and the prompt.
  await page.keyboard.press('r');
  await expect(statusText(page)).toContainText('Arrows to move');
  await expect(frog(page)).not.toHaveAttribute('display', 'none');

  // Win: dash straight across; traffic may interrupt — retry (R) until a run survives.
  let won = false;
  for (let attempt = 0; attempt < 12 && !won; attempt++) {
    await page.keyboard.press('r');
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(250);
    const s = (await statusText(page).textContent()) ?? '';
    won = s.includes('MADE IT');
  }
  expect(won).toBe(true);

  // Esc exits preview; clicking an object selects again (editing gestures restored).
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('preview-toggle')).toHaveAttribute('aria-pressed', 'false');
  await frog(page).click();
  await expect(page.getByTestId('add-behavior')).toBeVisible();
});

test('standalone exported bundle plays the same game', async ({ page }) => {
  test.slow();
  await page.goto('/frogger/index.html');
  const bFrog = page.locator('[data-savig-object="frog"]');
  const bStatus = page.locator('[data-savig-object="status"]');
  await expect(bFrog).toBeVisible();

  await page.keyboard.press('ArrowUp');
  await expect(bFrog).toHaveAttribute('transform', /translate\(0 -80\)/);
  await expect(bStatus).toContainText('SPLAT', { timeout: 6000 });

  await page.keyboard.press('r');
  await expect(bStatus).toContainText('Arrows to move');

  let won = false;
  for (let attempt = 0; attempt < 12 && !won; attempt++) {
    await page.keyboard.press('r');
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(250);
    const s = (await bStatus.textContent()) ?? '';
    won = s.includes('MADE IT');
  }
  expect(won).toBe(true);
});
