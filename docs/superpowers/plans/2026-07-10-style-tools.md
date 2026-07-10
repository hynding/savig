# Style Tools (Copy/Paste Style + Eyedropper) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copy/Paste Style commands (multi-select, WYSIWYG), a one-shot Eyedropper stage tool, and feature-detected native pixel-pick buttons in the Inspector.

**Architecture:** A transient `styleClipboard: VectorStyle | null` in the editor store plus three actions (`copyStyle`, `pasteStyle`, `applyStyleFrom`) that share one paste helper. UI is registry commands (`mod+alt+c/v`, tool key `i`), a ToolPalette entry, an eyedropper branch in Stage's pointer routing, and two Inspector buttons wrapping `window.EyeDropper`.

**Tech Stack:** pnpm monorepo, TS strict, Vitest colocated tests, Playwright e2e at repo-root `e2e/`.

**Spec:** `docs/superpowers/specs/2026-07-10-style-tools-design.md` (approved).

## Global Constraints

- Style = the asset's `VectorStyle` verbatim (fill, stroke, strokeWidth, strokeLinecap, strokeLinejoin, strokeDasharray, strokeDashoffset, fillGradient, strokeGradient). Never capture object-level animation or `tint`.
- **Paste WYSIWYG, one undo step:** set target asset style AND clear the target object's `colorTracks`/`gradientTracks`/`dashOffsetTrack` in the SAME commit. Leave `trim` untouched; when the target has `trim`, SKIP `strokeDasharray`/`strokeDashoffset` (never create the both-set conflict).
- Paste applies to every selected VECTOR object; groups/instances/text/svg skipped silently; zero vector targets → no commit (no history entry).
- All store ops route through `selectActiveObjects`/`selectActiveScope` (active-scene seam).
- `styleClipboard` is transient: not serialized, not in history, deep-copied (`structuredClone`) on capture.
- Eyedropper is ONE-SHOT: after any stage press it reverts `activeTool` to `'select'`.
- Test gotcha: fresh `useEditor.getState()` per read.
- Env: subagents run `node_modules/.bin/vitest run <path>`, `node_modules/.bin/tsc --noEmit`, `node_modules/.bin/eslint .`, `node_modules/.bin/playwright test` from the repo root. NEVER `pnpm install`/`pnpm approve-builds`; check/revert stray `pnpm-workspace.yaml` changes after e2e runs.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Store — styleClipboard + copyStyle/pasteStyle/applyStyleFrom

**Files:**
- Modify: `packages/editor-state/src/store-internals.ts` (state field + action signatures; mirror `keyframeClipboard`'s placement in the state interface, reset-keys union, and `TRANSIENT_DEFAULTS`)
- Modify: `packages/editor-state/src/store.ts` (three actions + one shared helper)
- Create: `packages/editor-state/src/store.style.test.ts`

**Interfaces:**
- Consumes: existing helpers already imported in store.ts (`selectActiveObjects`, `selectActiveScope`, `replaceObjectInScene`); `VectorStyle` type from `@savig/engine`.
- Produces: `styleClipboard: VectorStyle | null` (transient state); `copyStyle(): void`; `pasteStyle(): void`; `applyStyleFrom(sourceObjectId: string): void`. Task 2's registry predicates read `s.styleClipboard`; Task 3's Stage calls `applyStyleFrom`.

- [ ] **Step 1: Write the failing tests** — `packages/editor-state/src/store.style.test.ts`, using the same store-factory/fixture style as `store.trim.test.ts` (read it first; reuse its helpers for adding rects and entering symbols). Write each of these as a real test:

```
1. copyStyle with a vector selected → styleClipboard deep-equals the asset style; mutating the
   asset afterwards (setVectorStyle) does NOT change the captured clipboard (structuredClone).
2. copyStyle with no selection or a group selected → styleClipboard unchanged (null).
3. pasteStyle onto a single vector: asset style replaced verbatim (incl. gradients when present).
4. WYSIWYG clearing: target has colorTracks.fill + gradientTracks.stroke + dashOffsetTrack →
   after pasteStyle all three are gone (undefined), in the SAME history entry (one undo restores
   style AND tracks).
5. Trim-target skip: target has obj.trim, clipboard has strokeDasharray [1,1] + strokeDashoffset →
   pasted style contains everything EXCEPT those two fields (target keeps its previous dash fields,
   i.e. none), trim untouched.
6. Multi-select: two vectors + one group selected → both vectors restyled, group untouched,
   ONE history entry.
7. Zero-target paste (only a group selected, or empty clipboard) → history.past.length unchanged.
8. applyStyleFrom(sourceId) with a selection → selection restyled from source in one commit
   (same semantics as 3–6); with EMPTY selection → styleClipboard set from source, no commit.
9. In-symbol scope: paste inside an entered symbol restyles the symbol's object (fresh
   getState() reads; mirror the symbol-scope test in store.trim.test.ts).
```

- [ ] **Step 2: Run to verify failure**

Run: `node_modules/.bin/vitest run packages/editor-state/src/store.style.test.ts`
Expected: FAIL — `copyStyle` is not a function.

- [ ] **Step 3: store-internals.ts** — add exactly where the `keyframeClipboard` equivalents sit:

```ts
// state interface:
  /** Captured VectorStyle for Copy/Paste Style (transient; deep-copied on capture). */
  styleClipboard: VectorStyle | null;
// action signatures:
  /** Capture the selected vector's asset style into the style clipboard. */
  copyStyle(): void;
  /** Apply the style clipboard to every selected vector object (WYSIWYG: clears the pasted
   *  properties' animation tracks; skips dash fields on trimmed targets). One commit. */
  pasteStyle(): void;
  /** Eyedropper core: with a selection, restyle it from `sourceObjectId` (paste semantics) in one
   *  commit; with no selection, copy the source's style to the clipboard instead. */
  applyStyleFrom(sourceObjectId: string): void;
```

Add `styleClipboard: null` to the same initial-state/transient-defaults spots that carry `keyframeClipboard: null` (import `VectorStyle` as a type from `@savig/engine`).

- [ ] **Step 4: store.ts** — one shared helper + three actions (place near the clipboard ops):

```ts
// Module-level helper (top of file near other helpers). Applies `style` to every selected vector
// object: asset style replaced (dash fields skipped when the object has trim), and the object's
// paint/dash animation tracks cleared so the paste is WYSIWYG. Returns null when nothing applies.
function applyStyleToSelection(s: EditorState, style: VectorStyle): Project | null {
  const project = s.history.present;
  const targets = selectActiveObjects(s).filter((o) => s.selectedObjectIds.includes(o.id));
  let assets = project.assets;
  const objectUpdates: SceneObject[] = [];
  for (const obj of targets) {
    const asset = assets.find((a) => a.id === obj.assetId);
    if (!asset || asset.kind !== 'vector') continue;
    const next: VectorStyle = structuredClone(style);
    if (obj.trim) {
      delete next.strokeDasharray;
      delete next.strokeDashoffset;
      // keep the target's existing dash fields out too — trim owns the dash channel
      next.strokeDasharray = undefined as never;
      next.strokeDashoffset = undefined as never;
    }
    assets = assets.map((a) => (a.id === asset.id ? { ...asset, style: next } : a));
    objectUpdates.push({
      ...obj,
      colorTracks: undefined,
      gradientTracks: undefined,
      dashOffsetTrack: undefined,
    });
  }
  if (objectUpdates.length === 0) return null;
  let nextProject: Project = { ...project, assets };
  for (const upd of objectUpdates) {
    nextProject = replaceObjectInScene(nextProject, selectActiveScope(s), upd);
  }
  return nextProject;
}
```

NOTE for the implementer: the double `delete`/`undefined` block above is illustrative of intent —
implement it cleanly as: build `next` via object spread EXCLUDING the two dash keys when
`obj.trim` is set (e.g. `const { strokeDasharray, strokeDashoffset, ...rest } = cloned; next =
obj.trim ? rest : cloned`). Keep serialized JSON byte-clean (absent keys, not `undefined` values)
— see the `setInstanceTint` comment in this file for the convention. Also verify
`replaceObjectInScene` composes across multiple calls in one commit (it returns a new project;
chaining is how multi-object updates are done elsewhere — check `alignItemsUpdates` usage if
unsure).

```ts
  copyStyle() {
    const s = get();
    const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    const asset = s.history.present.assets.find((a) => a.id === obj.assetId);
    if (!asset || asset.kind !== 'vector') return;
    set({ styleClipboard: structuredClone(asset.style) });
  },
  pasteStyle() {
    const s = get();
    if (!s.styleClipboard) return;
    const next = applyStyleToSelection(s, s.styleClipboard);
    if (next) get().commit(next);
  },
  applyStyleFrom(sourceObjectId) {
    const s = get();
    const source = selectActiveObjects(s).find((o) => o.id === sourceObjectId);
    if (!source) return;
    const asset = s.history.present.assets.find((a) => a.id === source.assetId);
    if (!asset || asset.kind !== 'vector') return;
    if (s.selectedObjectIds.length === 0) {
      set({ styleClipboard: structuredClone(asset.style) });
      return;
    }
    const next = applyStyleToSelection(s, asset.style);
    if (next) get().commit(next);
  },
```

- [ ] **Step 5: Run tests to verify pass**

Run: `node_modules/.bin/vitest run packages/editor-state && node_modules/.bin/tsc --noEmit`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/editor-state/src/store-internals.ts packages/editor-state/src/store.ts packages/editor-state/src/store.style.test.ts
git commit -m "feat(editor-state): styleClipboard + copyStyle/pasteStyle/applyStyleFrom"
```

---

### Task 2: Commands + eyedropper ToolMode + palette entry

**Files:**
- Modify: `packages/editor-state/src/store-internals.ts:54-56` (add `'eyedropper'` to the `ToolMode` union)
- Modify: `packages/ui-core/src/commands/registry.ts` (two Edit commands + one `tool()` entry)
- Modify: `apps/react/src/ui/components/Toolbar/ToolPalette.tsx:8-20` (TOOLS entry)
- Modify: `apps/react/src/ui/components/Toolbar/ToolbarIcons.tsx` (icon `eyedropper` added to `IconName` union + SVG glyph)
- Test: the registry's existing integrity test file (find it: `packages/ui-core/src/commands/*.test.ts`), `apps/react/src/ui/components/Toolbar/ToolPalette.test.tsx` (append)

**Interfaces:**
- Consumes: `styleClipboard`, `copyStyle`, `pasteStyle` (Task 1); existing `tool()` helper and `hasSelection` predicate in registry.ts.
- Produces: commands `edit.copyStyle` (`mod+alt+c`), `edit.pasteStyle` (`mod+alt+v`), `tool.eyedropper` (key `i`); `ToolMode` includes `'eyedropper'`. Task 3's Stage switch relies on the ToolMode value; the e2e (Task 4) relies on the palette button's accessible name **"Eyedropper"**.

- [ ] **Step 1: Write failing tests** — registry test: `edit.copyStyle`/`edit.pasteStyle`/`tool.eyedropper` exist with the expected chords, and the integrity invariant still holds (`mod+alt+c` does not collide with `mod+c` because `chordMatches` requires `alt` equality — chord.ts:16). Palette test: an "Eyedropper" button renders and clicking it sets `activeTool === 'eyedropper'` (fresh getState()).

- [ ] **Step 2: Run to verify failure** — `node_modules/.bin/vitest run packages/ui-core/src/commands apps/react/src/ui/components/Toolbar`. Expected: FAIL.

- [ ] **Step 3: Implement** — store-internals ToolMode union: `| 'eyedropper'` appended. registry.ts:

```ts
  tool('tool.eyedropper', 'Eyedropper tool', 'eyedropper', 'i'),
  // in the Edit section:
  { id: 'edit.copyStyle', title: 'Copy style', category: 'Edit', chord: { mod: true, alt: true, key: 'c' }, preventDefault: true, when: hasSelection, unavailableHint: 'Select an object', run: (c) => c.state.copyStyle() },
  { id: 'edit.pasteStyle', title: 'Paste style', category: 'Edit', chord: { mod: true, alt: true, key: 'v' }, preventDefault: true, when: (s) => !!s.styleClipboard && hasSelection(s), unavailableHint: 'Copy a style first', run: (c) => c.state.pasteStyle() },
```

(If the `Command` chord type lacks `alt`, check `packages/ui-core/src/commands/types.ts` — `chordMatches` already reads `chord.alt` at chord.ts:16, so the field exists or is a one-line type addition.)
ToolPalette TOOLS array: `{ id: 'eyedropper', icon: 'eyedropper', label: 'Eyedropper' },` after brush. ToolbarIcons: add `'eyedropper'` to `IconName` and a 16×16 stroke-style glyph consistent with neighbors (a pipette: diagonal barrel + tip), e.g.:

```tsx
  eyedropper: (
    <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 4.5l2-2a1.4 1.4 0 0 1 2 2l-2 2" />
      <path d="M10.5 5.5l-6 6L3 14l2.5-1.5 6-6" />
    </g>
  ),
```

(match the file's actual per-icon JSX shape — copy a neighbor's structure.)

- [ ] **Step 4: Run tests to verify pass** — `node_modules/.bin/vitest run packages/ui-core apps/react && node_modules/.bin/tsc --noEmit`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/editor-state/src/store-internals.ts packages/ui-core/src/commands apps/react/src/ui/components/Toolbar
git commit -m "feat(ui): eyedropper tool mode + copy/paste style commands (mod+alt+c/v, key i)"
```

---

### Task 3: Stage eyedropper branch + Inspector pick buttons

**Files:**
- Modify: `apps/react/src/ui/components/Stage/Stage.tsx` (pointer routing near :559-619 — the eyedropper branch goes BEFORE the `s.activeTool === 'select'` branch at :619)
- Modify: `apps/react/src/ui/components/Inspector/Inspector.tsx` (pick buttons in the fill/stroke paint rows, ~:201-210 region)
- Test: `apps/react/src/ui/components/Stage/Stage.test.tsx`, `apps/react/src/ui/components/Inspector/Inspector.test.tsx` (append)

**Interfaces:**
- Consumes: `applyStyleFrom` (Task 1), `'eyedropper'` ToolMode (Task 2), existing `setVectorColor(property, value)` store action, existing intents plumbing (mirror how `setVectorStyle`/`setVectorColor` reach the Inspector).
- Produces: Inspector buttons `aria-label="pick fill color"` / `aria-label="pick stroke color"` (Task 4 e2e does NOT use them — they're native-picker-gated — but component tests do).

- [ ] **Step 1: Write failing tests** — Stage.test.tsx: with two rects and rect B selected, set `activeTool='eyedropper'`, dispatch a pointerdown on rect A's stage element → B's asset style equals A's, `activeTool === 'select'` (fresh getState()); pressing on empty canvas with eyedropper → tool reverts, history unchanged. Inspector.test.tsx: (a) no `window.EyeDropper` → no pick buttons; (b) stub `window.EyeDropper = class { open = async () => ({ sRGBHex: '#123456' }) }` → button renders, click → selected object's fill becomes `#123456` (via the `setVectorColor` path — with autoKey default ON assert accordingly, mirroring existing fill-edit tests); (c) stub whose `open` rejects with `DOMException('...', 'AbortError')` → click does not throw, no state change.

- [ ] **Step 2: Run to verify failure** — `node_modules/.bin/vitest run apps/react/src/ui/components/Stage apps/react/src/ui/components/Inspector`. Expected: FAIL.

- [ ] **Step 3: Stage** — locate the pointer-press routing (the `if (s.activeTool === 'select') {` branch at :619 handles object presses; read how it resolves the pressed object's id from the event/element). Insert BEFORE it:

```ts
    if (s.activeTool === 'eyedropper') {
      // One-shot: press on an object restyles the selection from it (or copies with no
      // selection); any press exits back to Select. No drag, no marquee.
      if (pressedObjectId) s.applyStyleFrom(pressedObjectId);
      s.setActiveTool('select');
      return;
    }
```

(`pressedObjectId` = however the select branch names the hit object id — reuse its resolution, do not re-implement hit-testing. If press routing is split between canvas-level and per-object handlers, put the object case in the per-object handler and the empty-canvas revert in the canvas handler.)

- [ ] **Step 4: Inspector** — in the paint row component for fill/stroke (region :201+), add next to each color input:

```tsx
  {typeof window !== 'undefined' && 'EyeDropper' in window && (
    <button
      aria-label={`pick ${prop} color`}
      title="Pick color from screen"
      onClick={async () => {
        try {
          const r = await new (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper().open();
          intents.setVectorColor(prop, r.sRGBHex);
        } catch {
          // AbortError (user cancelled) — deliberately swallowed
        }
      }}
    >⧉</button>
  )}
```

(Use the file's icon/button conventions — if there's an Icon component pattern, add a small `pick` glyph instead of the placeholder character; match how neighboring buttons are styled. Verify the intents object exposes `setVectorColor`; if the Inspector reaches it under a different name, follow the existing fill-input's commit path.)

- [ ] **Step 5: Run tests to verify pass** — `node_modules/.bin/vitest run apps/react && node_modules/.bin/tsc --noEmit && node_modules/.bin/eslint .`. Expected: PASS/clean.

- [ ] **Step 6: Commit**

```bash
git add apps/react/src/ui/components/Stage apps/react/src/ui/components/Inspector
git commit -m "feat(app-react): eyedropper stage pick + native EyeDropper buttons in Inspector"
```

---

### Task 4: E2E + full gates

**Files:**
- Create: `e2e/style-tools.spec.ts`

**Interfaces:**
- Consumes: palette button "Eyedropper", commands "Copy style"/"Paste style" (via keyboard chords), stage attrs.

- [ ] **Step 1: Write the spec** — follow the house style (draw-rect flow from `e2e/color-animation.spec.ts`; Stage-scoped selectors):

```ts
import { test, expect } from '@playwright/test';

async function drawRect(page, x1: number, y1: number, x2: number, y2: number) {
  await page.getByRole('button', { name: 'Rectangle' }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2);
  await page.mouse.up();
}

test('copy style / paste style moves fill between rects', async ({ page }) => {
  await page.goto('/');
  await drawRect(page, 60, 60, 140, 120);   // rect A
  await drawRect(page, 180, 60, 260, 120);  // rect B (selected after draw)
  const shapes = page.locator('section[aria-label="Stage"] [data-savig-object] > *');
  await expect(shapes).toHaveCount(2);

  // Recolor A so the two fills differ, then copy A's style.
  await shapes.first().click(); // select A (select tool is active after drawing? if not, press 'v' first)
  await page.keyboard.press('v');
  await shapes.first().click();
  await page.getByLabel('fill', { exact: true }).fill('#ff0000');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Alt+c' : 'Control+Alt+c');

  // Select B, paste style.
  await shapes.nth(1).click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Alt+v' : 'Control+Alt+v');
  await expect(shapes.nth(1)).toHaveAttribute('fill', '#ff0000');
});

test('eyedropper restyles the selection from the clicked object', async ({ page }) => {
  await page.goto('/');
  await drawRect(page, 60, 60, 140, 120);
  await drawRect(page, 180, 60, 260, 120);
  const shapes = page.locator('section[aria-label="Stage"] [data-savig-object] > *');
  await page.keyboard.press('v');
  await shapes.first().click();
  await page.getByLabel('fill', { exact: true }).fill('#00aa00');

  // Select B, hit the eyedropper key, click A.
  await shapes.nth(1).click();
  await page.keyboard.press('i');
  await shapes.first().click();
  await expect(shapes.nth(1)).toHaveAttribute('fill', '#00aa00');
  await expect(page.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true');
});
```

Adapt the fill-commit gesture and post-draw selection state to how `color-animation.spec.ts` actually does it (autoKey default ON means the fill edit keyframes — the static asset fill may not change; if so, assert the STAGE fill attr, which reflects the sampled value, exactly as written above). Note the keyboard chord syntax: Playwright wants `Meta+Alt+KeyC` style if plain letters fail with Alt — use `Alt` + the physical key (`KeyC`) if `Alt+c` produces a dead key on macOS.

- [ ] **Step 2: Run the spec** — `pkill -f vite || true; node_modules/.bin/playwright test e2e/style-tools.spec.ts`. Expected: PASS (feature already implemented). Debug selector/gesture mismatches against the real app, not by weakening assertions.

- [ ] **Step 3: Full gates** — `node_modules/.bin/vitest run && node_modules/.bin/tsc --noEmit && node_modules/.bin/eslint . && node_modules/.bin/playwright test`. Expected: all green. Check `git status` for a stray `pnpm-workspace.yaml` change and revert it.

- [ ] **Step 4: Commit**

```bash
git add e2e/style-tools.spec.ts
git commit -m "test(e2e): copy/paste style + eyedropper flows"
```

---

## Out of scope (per spec)

Text-asset paste; clipboard persistence; partial paste; pixel-gradient sampling; DSL/MCP layer.
