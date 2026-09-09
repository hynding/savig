/**
 * M9 interactivity/scripting e2e (Task 8), real Chromium, all authoring through the real UI.
 *
 * Idioms borrowed from precedent specs:
 * - Draw gesture (Tools group -> Rectangle/Text -> drag/click): delete-object.spec.ts,
 *   scenes-editor.spec.ts, text-tool.spec.ts.
 * - showSaveFilePicker/showOpenFilePicker stubbing + confirm() stub for New:
 *   open-svg-roundtrip.spec.ts.
 * - Export-bundle-and-load-standalone plumbing (Export button -> zip download -> unzip ->
 *   file:// index.html): export.spec.ts, primitives.spec.ts, scenes-transition.spec.ts.
 * - `section[aria-label="Stage"]`-scoped object queries throughout (AssetPanel/SceneStrip
 *   thumbnails also emit `data-savig-object` — the M4 lesson banked in project memory).
 *
 * Behaviors/expressions commit on blur (CommitField in BehaviorsSection.tsx) — every typed
 * expression/arg is followed by `.blur()` before any assertion that depends on it, per the
 * task brief's documented UI wrinkle.
 *
 * KNOWN ARCHITECTURE LIMITATION (verified empirically, not a test bug): the editor's
 * interactive-preview session is built from `selectEditProject`, which — for a multi-scene
 * project — returns a SINGLE-SCENE VIEW of whichever scene is currently active in the Scenes
 * panel (`scenes: undefined`, synthesized scene id `scene-root`; see
 * packages/editor-state/src/selectors.ts). `gotoScene` therefore cannot navigate to a REAL
 * second scene while previewing inside the editor — there is no in-editor multi-scene
 * master-timeline playback at all (matches the M4/M5 "in-editor master-timeline
 * preview/scrub... deferred" project-memory note). The exported runtime bundle's session is
 * built from the FULL multi-scene project (`packages/runtime/src/index.ts`), where gotoScene
 * genuinely crosses scenes. Test 3 below therefore authors its 2-scene project through the
 * real UI and proves the gotoScene -> sceneStart chain via the exported bundle (the same real
 * execution surface exercised by tests 6/7) rather than the in-editor preview toggle used by
 * tests 1/2/4/5/8 — this keeps the asserted behavior real per the task brief's guidance to
 * adapt the authoring venue, not fabricate the result, when a literal UI flow doesn't exist.
 *
 * Exported-bundle `<g data-savig-object>` elements fail Playwright's default actionability
 * "visible" check (their own computed bounding box reads oddly for an unfilled group wrapper)
 * even though they render and are genuinely clickable — `{ force: true }` is used for every
 * click against exported-bundle content (verified against Chromium interactively; the click
 * lands and the counted/scene-changed effect is observed immediately after).
 */
import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Tools group -> Rectangle -> drag a small rect on the Stage; leaves Select active after. */
async function drawRect(page: import('@playwright/test').Page, box: { x: number; y: number }) {
  const stage = page.locator('section[aria-label="Stage"]');
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 120);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Select' }).click();
  return stage.locator('[data-savig-object]').first();
}

/** Text tool -> click-to-place -> set content via the Inspector's text field (commits on blur). */
async function addText(page: import('@playwright/test').Page, box: { x: number; y: number }, content: string) {
  const stage = page.locator('section[aria-label="Stage"]');
  const before = await stage.locator('[data-savig-object]').count();
  await page.getByRole('button', { name: 'Text' }).click();
  await page.mouse.click(box.x + 250, box.y + 250);
  const contentField = page.getByLabel('text content', { exact: true });
  await contentField.fill(content);
  await contentField.blur();
  await expect(stage.locator('[data-savig-object]')).toHaveCount(before + 1);
  return stage.locator('[data-savig-object]').nth(before);
}

/** Deselect by clicking empty Stage canvas -> Inspector shows the project-level panel. */
async function deselect(page: import('@playwright/test').Page, box: { x: number; y: number }) {
  await page.mouse.click(box.x + 350, box.y + 350);
}

/** Adds a new behavior (via the currently-visible BehaviorsSection's `add-behavior` button) and
 *  returns its behaviorId, parsed off the freshly-appended `behavior-row-<id>` testid. */
async function addBehavior(page: import('@playwright/test').Page): Promise<string> {
  const rowsBefore = await page.locator('[data-testid^="behavior-row-"]').count();
  await page.getByTestId('add-behavior').click();
  const rows = page.locator('[data-testid^="behavior-row-"]');
  await expect(rows).toHaveCount(rowsBefore + 1);
  const testId = await rows.nth(rowsBefore).getAttribute('data-testid');
  return testId!.replace('behavior-row-', '');
}

/** Adds an action to behavior `bId` and returns its index (0-based). */
async function addAction(page: import('@playwright/test').Page, bId: string): Promise<number> {
  const rowsBefore = await page.locator(`[data-testid^="action-row-${bId}-"]`).count();
  await page.getByTestId(`add-action-${bId}`).click();
  return rowsBefore;
}

async function fillAndBlur(page: import('@playwright/test').Page, testId: string, value: string) {
  const field = page.getByTestId(testId);
  await field.fill(value);
  await field.blur();
}

test.describe('M9 interactivity', () => {
  test('counter button: click -> setVar + setText -> preview -> 2 clicks -> text reads Score: 2', async ({ page }) => {
    await page.goto('/');
    const stage = page.locator('section[aria-label="Stage"]');
    const svg = stage.locator('svg').first();
    const box = (await svg.boundingBox())!;

    const rect = await drawRect(page, box);
    const text = await addText(page, box, 'Score: 0');
    const textId = await text.getAttribute('data-savig-object');

    await deselect(page, box);
    await page.getByLabel('new variable name').fill('score');
    await page.getByLabel('new variable initial').fill('0');
    await page.getByTestId('add-variable').click();
    await expect(page.getByTestId('variable-name-score')).toBeVisible();

    await rect.click();
    const bId = await addBehavior(page); // default event = 'click' (POINTER_EVENT_KINDS[0])
    await expect(page.getByTestId(`behavior-event-${bId}`)).toHaveValue('click');

    const a0 = await addAction(page, bId);
    await page.getByTestId(`action-kind-${bId}-${a0}`).selectOption('setVar');
    await fillAndBlur(page, `action-arg-${bId}-${a0}-name`, 'score');
    await fillAndBlur(page, `action-arg-${bId}-${a0}-value`, 'score + 1');
    await expect(page.getByTestId(`expr-error-${bId}-${a0}`)).toHaveCount(0);

    const a1 = await addAction(page, bId);
    await page.getByTestId(`action-kind-${bId}-${a1}`).selectOption('setText');
    await page.getByTestId(`action-arg-${bId}-${a1}-targetId`).selectOption(textId!);
    await fillAndBlur(page, `action-arg-${bId}-${a1}-value`, "'Score: ' + score");
    await expect(page.getByTestId(`expr-error-${bId}-${a1}`)).toHaveCount(0);

    await page.getByTestId('preview-toggle').click();
    await expect(page.getByTestId('preview-toggle')).toHaveAttribute('aria-pressed', 'true');
    await rect.click();
    await rect.click();

    await expect(stage.locator(`[data-savig-object="${textId}"] text`)).toHaveText('Score: 2');
  });

  test('keyboard: global keydown[ArrowRight] -> setPosition dx=10 -> 3 presses -> transform carries translate(10', async ({ page }) => {
    await page.goto('/');
    const stage = page.locator('section[aria-label="Stage"]');
    const svg = stage.locator('svg').first();
    const box = (await svg.boundingBox())!;

    const rect = await drawRect(page, box);
    const rectId = await rect.getAttribute('data-savig-object');

    await deselect(page, box);
    const gId = await addBehavior(page);
    await page.getByTestId(`behavior-event-${gId}`).selectOption('keydown');
    await fillAndBlur(page, `behavior-key-${gId}`, 'ArrowRight');

    const a0 = await addAction(page, gId);
    await page.getByTestId(`action-kind-${gId}-${a0}`).selectOption('setPosition');
    await page.getByTestId(`action-arg-${gId}-${a0}-targetId`).selectOption(rectId!);
    await fillAndBlur(page, `action-arg-${gId}-${a0}-dx`, '10');
    await expect(page.getByTestId(`expr-error-${gId}-${a0}`)).toHaveCount(0);

    await page.getByTestId('preview-toggle').click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');

    await expect(rect).toHaveAttribute('transform', /translate\(10\b/);
  });

  test('gotoScene: click behavior jumps to scene2, whose sceneStart handler sets text (exported bundle)', async ({ page }) => {
    // See the file-level comment: in-editor preview cannot cross real scenes (selectEditProject
    // strips `scenes`), so this test authors the 2-scene project through the real UI and proves
    // the gotoScene -> sceneStart chain via the exported runtime bundle, whose session is built
    // from the full multi-scene project.
    await page.addInitScript(() => {
      delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
      delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
    });
    await page.goto('/');
    const stage = page.locator('section[aria-label="Stage"]');
    const svg = stage.locator('svg').first();
    const box = (await svg.boundingBox())!;

    // Scene 1: a rect (the click target).
    const rect = await drawRect(page, box);
    const rectId = await rect.getAttribute('data-savig-object');

    // Scene 2: add + a text object living there.
    await page.getByRole('button', { name: 'Add scene' }).click();
    const tiles = page.getByRole('list', { name: 'Scenes' }).getByRole('listitem');
    await expect(tiles).toHaveCount(2);
    // The static rect has no animation, so scene1's auto-computed duration defaults to 0 — a
    // zero-width span means `sceneAtTime(0)` resolves straight to scene2 and the LATER
    // sceneStart[scene-root]->pause guard (below) would never get a chance to fire. Give scene1
    // a real window so t=0 genuinely belongs to it.
    await tiles.nth(0).getByLabel('Scene duration').fill('2');
    const text = await addText(page, box, 'waiting');
    const textId = await text.getAttribute('data-savig-object');

    // Back to scene 1: hold the bundle paused on load (a sceneStart[scene1] -> pause handler,
    // the documented "click-to-start" mechanism — see runtime/src/index.ts's `autoplayIntent`)
    // so the LATER click's gotoScene is provably the sole cause of the scene2 sceneStart, not
    // ordinary autoplay running the master clock past scene1 on its own.
    await tiles.nth(0).getByRole('button', { name: /^Scene/ }).click();
    await deselect(page, box);
    const pauseId = await addBehavior(page);
    await page.getByTestId(`behavior-event-${pauseId}`).selectOption('sceneStart');
    await page.getByTestId(`behavior-scene-${pauseId}`).selectOption('scene-root');
    const pa0 = await addAction(page, pauseId); // new actions default to 'play' — select 'pause'
    await page.getByTestId(`action-kind-${pauseId}-${pa0}`).selectOption('pause');

    // Select the rect, add click -> gotoScene(scene2).
    await rect.click();
    const bId = await addBehavior(page);
    const a0 = await addAction(page, bId);
    await page.getByTestId(`action-kind-${bId}-${a0}`).selectOption('gotoScene');
    const sceneSelect = page.getByTestId(`action-arg-${bId}-${a0}-sceneId`);
    const sceneOptionValues = await sceneSelect
      .locator('option')
      .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
    const scene2Id = sceneOptionValues.find((v) => v !== '' && v !== 'scene-root')!;
    expect(scene2Id).toBeTruthy();
    await sceneSelect.selectOption(scene2Id);

    // Scene 2 must be active when authoring the global handler so its `behaviorTargets` list
    // (scoped to the active scene, mirroring the Inspector's object-target scoping) includes the
    // scene-2 text object.
    await tiles.nth(1).getByRole('button', { name: /^Scene/ }).click();
    await deselect(page, box);
    const gId = await addBehavior(page);
    await page.getByTestId(`behavior-event-${gId}`).selectOption('sceneStart');
    await page.getByTestId(`behavior-scene-${gId}`).selectOption(scene2Id);
    const ga0 = await addAction(page, gId);
    await page.getByTestId(`action-kind-${gId}-${ga0}`).selectOption('setText');
    await page.getByTestId(`action-arg-${gId}-${ga0}-targetId`).selectOption(textId!);
    await fillAndBlur(page, `action-arg-${gId}-${ga0}-value`, "'reached'");
    await expect(page.getByTestId(`expr-error-${gId}-${ga0}`)).toHaveCount(0);

    // Export the runtime bundle and load it standalone.
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export' }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream as NodeJS.ReadableStream) chunks.push(c as Buffer);
    const zipBytes = new Uint8Array(Buffer.concat(chunks));
    const dir = mkdtempSync(join(tmpdir(), 'savig-e2e-'));
    const files = unzipSync(zipBytes);
    for (const [p, data] of Object.entries(files)) {
      const full = join(dir, p);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, data);
    }
    expect(Object.keys(files)).toContain('index.html');

    const exported = await page.context().newPage();
    await exported.goto(pathToFileURL(join(dir, 'index.html')).href);
    await exported.waitForTimeout(300);

    // Multi-scene bundle ids are `<sceneId>:<renderId>`-prefixed.
    const rectEl = exported.locator(`[data-savig-object$="${rectId}"]`);
    await expect(rectEl).toHaveCount(1);
    const textEl = exported.locator(`[data-savig-object$="${textId}"] text`);
    await expect(textEl).toHaveText('waiting');

    await rectEl.click({ force: true }); // fires gotoScene(scene2) -> tickTo -> sceneStart(scene2)
    await expect(textEl).toHaveText('reached');
  });

  test('hover: hoverEnter -> setOpacity 0.5, hoverLeave -> setOpacity 1', async ({ page }) => {
    await page.goto('/');
    const stage = page.locator('section[aria-label="Stage"]');
    const svg = stage.locator('svg').first();
    const box = (await svg.boundingBox())!;

    const rect = await drawRect(page, box);
    await rect.click();

    const enterId = await addBehavior(page);
    await page.getByTestId(`behavior-event-${enterId}`).selectOption('hoverEnter');
    const ea0 = await addAction(page, enterId);
    await page.getByTestId(`action-kind-${enterId}-${ea0}`).selectOption('setOpacity');
    await fillAndBlur(page, `action-arg-${enterId}-${ea0}-value`, '0.5'); // no targetId -> own object

    const leaveId = await addBehavior(page);
    await page.getByTestId(`behavior-event-${leaveId}`).selectOption('hoverLeave');
    const la0 = await addAction(page, leaveId);
    await page.getByTestId(`action-kind-${leaveId}-${la0}`).selectOption('setOpacity');
    await fillAndBlur(page, `action-arg-${leaveId}-${la0}-value`, '1');

    await page.getByTestId('preview-toggle').click();

    await rect.hover();
    await expect(rect).toHaveAttribute('opacity', '0.5');

    await page.mouse.move(box.x + 350, box.y + 350); // leave the object entirely
    await expect(rect).toHaveAttribute('opacity', '1');
  });

  test('preview gating: clicking does not select while previewing; Esc exits; selection resumes', async ({ page }) => {
    await page.goto('/');
    const stage = page.locator('section[aria-label="Stage"]');
    const svg = stage.locator('svg').first();
    const box = (await svg.boundingBox())!;

    const rect = await drawRect(page, box);
    await rect.click();
    await expect(page.locator('[data-testid^="selection-outline-"]')).toHaveCount(1);
    await page.keyboard.press('Escape'); // Escape outside preview must NOT toggle preview
    await expect(page.getByTestId('preview-toggle')).toHaveAttribute('aria-pressed', 'false');

    await page.getByTestId('preview-toggle').click();
    await expect(page.getByTestId('preview-toggle')).toHaveAttribute('aria-pressed', 'true');
    // Entering preview clears selection.
    await expect(page.locator('[data-testid^="selection-outline-"]')).toHaveCount(0);

    await rect.click(); // no behaviors authored -> would select outside preview
    await expect(page.locator('[data-testid^="selection-outline-"]')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('preview-toggle')).toHaveAttribute('aria-pressed', 'false');

    await rect.click();
    await expect(page.locator('[data-testid^="selection-outline-"]')).toHaveCount(1);
  });

  test('round-trip: export counter as animated SVG, reopen, behaviors survive, preview still works', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as {
        __savedChunks?: Uint8Array[];
        showSaveFilePicker?: unknown;
        showOpenFilePicker?: unknown;
      };
      w.__savedChunks = [];
      w.showSaveFilePicker = async () => ({
        createWritable: async () => ({
          write: async (data: Uint8Array) => {
            w.__savedChunks!.push(data);
          },
          close: async () => {},
        }),
      });
      delete w.showOpenFilePicker;
      window.confirm = () => true;
    });
    await page.goto('/');
    const stage = page.locator('section[aria-label="Stage"]');
    const svg = stage.locator('svg').first();
    const box = (await svg.boundingBox())!;

    const rect = await drawRect(page, box);
    const text = await addText(page, box, 'Score: 0');
    const textId = await text.getAttribute('data-savig-object');

    await deselect(page, box);
    await page.getByLabel('new variable name').fill('score');
    await page.getByLabel('new variable initial').fill('0');
    await page.getByTestId('add-variable').click();

    await rect.click();
    const bId = await addBehavior(page);
    const a0 = await addAction(page, bId);
    await page.getByTestId(`action-kind-${bId}-${a0}`).selectOption('setVar');
    await fillAndBlur(page, `action-arg-${bId}-${a0}-name`, 'score');
    await fillAndBlur(page, `action-arg-${bId}-${a0}-value`, 'score + 1');
    const a1 = await addAction(page, bId);
    await page.getByTestId(`action-kind-${bId}-${a1}`).selectOption('setText');
    await page.getByTestId(`action-arg-${bId}-${a1}-targetId`).selectOption(textId!);
    await fillAndBlur(page, `action-arg-${bId}-${a1}-value`, "'Score: ' + score");

    await page.locator('section[aria-label="Stage"]').click();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.getByLabel('Command search').fill('export animated svg');
    await palette.getByLabel('Command search').press('Enter');
    await page.waitForFunction(() => (window as unknown as { __savedChunks: Uint8Array[] }).__savedChunks.length > 0);

    // Reset to blank before reopening so the reopen is provably attributable (open-svg-roundtrip
    // precedent), then rebuild a File from the captured bytes.
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(stage.locator('[data-savig-object]')).toHaveCount(0);

    await page.evaluate(() => {
      const w = window as unknown as { __savedChunks: Uint8Array[]; showOpenFilePicker?: unknown };
      const total = w.__savedChunks.reduce((n, c) => n + c.length, 0);
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of w.__savedChunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const file = new File([bytes], 'counter.svg', { type: 'image/svg+xml' });
      w.showOpenFilePicker = async () => [{ getFile: async () => file }];
    });
    await page.getByRole('button', { name: 'Open' }).click();
    await expect(stage.locator('[data-savig-object]')).toHaveCount(2);
    await expect(page.getByRole('alert')).toHaveCount(0);

    // Behaviors survived the round-trip: reselect the rect (first placed object) and check the
    // Inspector shows the reopened behavior with its authored event kind.
    const rectAfter = stage.locator('[data-savig-object]').first();
    await rectAfter.click();
    const rowsAfter = page.locator('[data-testid^="behavior-row-"]');
    await expect(rowsAfter).toHaveCount(1);
    const reopenedBId = (await rowsAfter.first().getAttribute('data-testid'))!.replace('behavior-row-', '');
    await expect(page.getByTestId(`behavior-event-${reopenedBId}`)).toHaveValue('click');

    // Preview still works end to end after the round trip.
    await page.getByTestId('preview-toggle').click();
    await rectAfter.click();
    await rectAfter.click();
    const textAfter = stage.locator('[data-savig-object]').nth(1);
    await expect(textAfter.locator('text')).toHaveText('Score: 2');
  });

  test('bundle: exported runtime bundle honors the counter standalone', async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
      delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
    });
    await page.goto('/');
    const stage = page.locator('section[aria-label="Stage"]');
    const svg = stage.locator('svg').first();
    const box = (await svg.boundingBox())!;

    const rect = await drawRect(page, box);
    const rectId = await rect.getAttribute('data-savig-object');
    const text = await addText(page, box, 'Score: 0');
    const textId = await text.getAttribute('data-savig-object');

    await deselect(page, box);
    await page.getByLabel('new variable name').fill('score');
    await page.getByLabel('new variable initial').fill('0');
    await page.getByTestId('add-variable').click();

    await rect.click();
    const bId = await addBehavior(page);
    const a0 = await addAction(page, bId);
    await page.getByTestId(`action-kind-${bId}-${a0}`).selectOption('setVar');
    await fillAndBlur(page, `action-arg-${bId}-${a0}-name`, 'score');
    await fillAndBlur(page, `action-arg-${bId}-${a0}-value`, 'score + 1');
    const a1 = await addAction(page, bId);
    await page.getByTestId(`action-kind-${bId}-${a1}`).selectOption('setText');
    await page.getByTestId(`action-arg-${bId}-${a1}-targetId`).selectOption(textId!);
    await fillAndBlur(page, `action-arg-${bId}-${a1}-value`, "'Score: ' + score");

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export' }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream as NodeJS.ReadableStream) chunks.push(c as Buffer);
    const zipBytes = new Uint8Array(Buffer.concat(chunks));
    const dir = mkdtempSync(join(tmpdir(), 'savig-e2e-'));
    const files = unzipSync(zipBytes);
    for (const [p, data] of Object.entries(files)) {
      const full = join(dir, p);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, data);
    }
    expect(Object.keys(files)).toContain('index.html');

    const exported = await page.context().newPage();
    await exported.goto(pathToFileURL(join(dir, 'index.html')).href);
    await exported.waitForTimeout(300);

    const rectEl = exported.locator(`[data-savig-object$="${rectId}"]`);
    const textEl = exported.locator(`[data-savig-object$="${textId}"] text`);
    await expect(rectEl).toHaveCount(1);
    await expect(textEl).toHaveText('Score: 0');

    await rectEl.click({ force: true });
    await rectEl.click({ force: true });
    await expect(textEl).toHaveText('Score: 2'); // standalone, no editor involved
  });

  test('legacy parity: a project with zero interactions arms zero listeners in preview', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New from template' }).click();
    const gallery = page.getByRole('dialog', { name: 'Template gallery' });
    await expect(gallery).toBeVisible();
    await gallery.getByText('Bouncing ball').click();
    await expect(gallery).toBeHidden();
    // Pause first: the template autoplays, and a moving object's transform would otherwise
    // change on its own between reads, making the "click has no effect" comparison meaningless.
    await page.getByRole('button', { name: 'Pause' }).click();

    const stage = page.locator('section[aria-label="Stage"]');
    const obj = stage.locator('[data-savig-object]').first();
    const before = await obj.getAttribute('transform');

    await page.getByTestId('preview-toggle').click();
    await expect(page.getByTestId('preview-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(obj).toHaveAttribute('transform', before!); // preview entry alone is a no-op

    await obj.click(); // zero behaviors authored on this object/project -> zero effect
    await expect(obj).toHaveAttribute('transform', before!);
    await expect(page.locator('[data-testid^="selection-outline-"]')).toHaveCount(0); // still gated

    // Playhead behavior unchanged: transport still drives playback while previewing.
    await page.getByRole('button', { name: 'Play' }).click();
    await page.waitForTimeout(300);
    const midTransform = await obj.getAttribute('transform');
    expect(midTransform).not.toBe(before);
    await page.getByRole('button', { name: 'Pause' }).click();

    await page.getByTestId('preview-toggle').click();
    await expect(page.getByTestId('preview-toggle')).toHaveAttribute('aria-pressed', 'false');
    await obj.click();
    await expect(page.locator('[data-testid^="selection-outline-"]')).toHaveCount(1); // normal select restored
  });
});
