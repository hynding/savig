# Slice 27 Lock-aware Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a locked object's timeline row + keyframe diamonds non-interactive (no select, no retime drag) and dimmed, closing the Slice-19 lock residual.

**Architecture:** UI-only in `Timeline.tsx`: prepend `if (obj.locked) return;` to each of the 6 keyframe diamonds' `onPointerDown` (the single handler that does both select and the S25 retime drag-start); guard the row-label `onClick`; add a `locked` class to the row (dim via CSS). No store change — the timeline diamonds are the only path that selects a locked object's keyframes (Stage + Layers panel already refuse locked, S19).

**Tech Stack:** TypeScript (strict), React 18, Zustand, Vitest + RTL, Playwright.

## Global Constraints

- TypeScript strict; no `any`. Match surrounding code style.
- Each of the 6 keyframe diamonds' `onPointerDown` starts with `if (obj.locked) return;` (blocks select AND the S25 retime drag). The row-label `onClick` selects only when `!obj.locked`. The row gets `${obj.locked ? styles.locked : ''}`.
- JS guards (NOT CSS `pointer-events`) so the non-interaction is unit-testable in jsdom.
- Editor-only: no engine/store/persistence/render/runtime/export/migration change (v4).
- Run the full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Timeline guards + dim + unit tests

**Files:**
- Modify: `src/ui/components/Timeline/Timeline.tsx`
- Modify: `src/ui/components/Timeline/Timeline.module.css`
- Test: `src/ui/components/Timeline/Timeline.test.tsx`

**Interfaces:**
- Consumes: `obj.locked` (already on `SceneObject`); existing `selectObject` / `selectXKeyframe` / `startKeyframeDrag`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/components/Timeline/Timeline.test.tsx`:

```ts
describe('lock-aware timeline', () => {
  function lockedKeyedObject() {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(1);
    useEditor.getState().setProperty('x', 50); // x keyframe at t=1
    useEditor.getState().toggleObjectLock(id); // locks + deselects
    return id;
  }

  it('clicking a locked object keyframe diamond does NOT select it', () => {
    const id = lockedKeyedObject();
    render(<Timeline />);
    fireEvent.pointerDown(screen.getByTestId(`keyframe-${id}-x-1`));
    expect(useEditor.getState().selectedKeyframe).toBeNull();
  });

  it('dragging a locked object keyframe diamond does NOT retime it', () => {
    const id = lockedKeyedObject();
    render(<Timeline />);
    const diamond = screen.getByTestId(`keyframe-${id}-x-1`);
    fireEvent.pointerDown(diamond, { clientX: 1 * PX_PER_SECOND });
    fireEvent.pointerMove(window, { clientX: 2 * PX_PER_SECOND });
    fireEvent.pointerUp(window, { clientX: 2 * PX_PER_SECOND });
    const track = useEditor.getState().history.present.objects[0].tracks.x!;
    expect(track.some((k) => Math.abs(k.time - 1) < 1e-6)).toBe(true); // still at t=1
    expect(track.some((k) => Math.abs(k.time - 2) < 1e-6)).toBe(false); // not retimed
  });

  it('clicking a locked object row label does NOT select the object', () => {
    const id = lockedKeyedObject();
    render(<Timeline />);
    fireEvent.click(screen.getByTestId(`track-label-${id}`));
    expect(useEditor.getState().selectedObjectId).toBeNull();
  });

  it('a locked object row is dimmed (has the locked class)', () => {
    const id = lockedKeyedObject();
    render(<Timeline />);
    expect(screen.getByTestId(`track-row-${id}`).className).toMatch(/locked/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/components/Timeline/Timeline.test.tsx -t "lock-aware"`
Expected: FAIL — the locked diamond still selects/retimes; the label still selects; no `locked` class.

- [ ] **Step 3: Guard the label + the 6 diamonds + add the row class**

In `src/ui/components/Timeline/Timeline.tsx`:

1. The row `<div>` (testid `track-row-<id>`) currently is `<div key={obj.id} className={styles.row} data-testid={`track-row-${obj.id}`}>`. Add the locked class:

```tsx
            <div key={obj.id} className={`${styles.row} ${obj.locked ? styles.locked : ''}`} data-testid={`track-row-${obj.id}`}>
```

2. The label `onClick={() => selectObject(obj.id)}` becomes:

```tsx
                onClick={() => {
                  if (!obj.locked) selectObject(obj.id);
                }}
```

3. In EACH of the 6 keyframe diamonds' `onPointerDown`, add `if (obj.locked) return;` as the first statement (before `e.stopPropagation()`). For the scalar diamond:

```tsx
                          onPointerDown={(e) => {
                            if (obj.locked) return;
                            e.stopPropagation();
                            selectKeyframe({ objectId: obj.id, property: prop, time: kf.time });
                            startKeyframeDrag(e, kf.time);
                          }}
```

Do the same for the shape, color, gradient, dash, and progress diamonds (each keeps its
existing body and gains `if (obj.locked) return;` as the first line of `onPointerDown`).

- [ ] **Step 4: Add the dim CSS**

In `src/ui/components/Timeline/Timeline.module.css`, after the `.row` rule:

```css
.locked { opacity: 0.45; }
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm vitest run src/ui/components/Timeline/Timeline.test.tsx`
Expected: PASS (the 4 new lock-aware tests + all existing Timeline tests, incl. the S25 drag-to-retime tests on UNlocked objects).

- [ ] **Step 6: Typecheck/lint + commit**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

```bash
git add src/ui/components/Timeline/Timeline.tsx src/ui/components/Timeline/Timeline.module.css src/ui/components/Timeline/Timeline.test.tsx
git commit -m "feat(slice27): lock-aware timeline (locked rows/diamonds non-interactive + dimmed)"
```

---

### Task 2: End-to-end — a locked object's keyframe can't be dragged

**Files:**
- Create: `e2e/lock-timeline.spec.ts`

**Interfaces:**
- Consumes: the whole feature (Task 1) + the Layers-panel lock toggle (S19).

- [ ] **Step 1: Write the e2e**

Create `e2e/lock-timeline.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('a locked object keyframe cannot be dragged to retime in the timeline', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect (auto-selected); key rotation at t=0 via the Inspector.
  await page
    .getByRole('group', { name: 'Tools' })
    .getByRole('button', { name: 'Rectangle', exact: true })
    .click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 160);
  await page.mouse.up();
  const rotField = page.getByLabel('rotation', { exact: true });
  await rotField.fill('40');
  await rotField.blur();

  // Lock the object via the Layers panel.
  const row = page.locator('section[aria-label="Assets"] [data-testid^="layer-"]').first();
  const rowId = (await row.getAttribute('data-testid'))!.replace('layer-', '');
  await page.getByTestId(`lock-${rowId}`).click();

  // Attempt to drag its rotation diamond at t=0 right by 100px — it must NOT move.
  const diamond = page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-0"]').first();
  const db = (await diamond.boundingBox())!;
  await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2);
  await page.mouse.down();
  await page.mouse.move(db.x + db.width / 2 + 100, db.y + db.height / 2);
  await page.mouse.up();

  await expect(page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-0"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="keyframe-"][data-testid$="-rotation-1"]')).toHaveCount(0);
});
```

- [ ] **Step 2: Run the e2e**

Run: `pnpm exec playwright test e2e/lock-timeline.spec.ts`
Expected: PASS (the diamond stays at t=0; the locked guard blocked the drag).

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/lock-timeline.spec.ts
git commit -m "test(e2e): a locked object's keyframe cannot be dragged in the timeline"
```

---

## Self-Review (plan vs spec)

- **§2 guard each diamond `onPointerDown` (blocks select + S25 drag); guard the label `onClick`; row `locked` class** → Task 1 Step 3 + the no-select / no-retime / no-label-select / locked-class unit tests. ✅
- **§3 timeline guard fully closes the residual** → the diamond guard covers both select and the drag-start (the no-retime test proves the drag is blocked, not just select). ✅
- **§4 `.locked { opacity: 0.45 }` dim** → Task 1 Step 4 + the locked-class test. ✅
- **§5 editor-only (no store change)** → only `Timeline.tsx` + `.module.css` + tests + one e2e. ✅
- **§8 testing (4 Timeline unit + e2e)** → Tasks 1–2. ✅
- **Type/name consistency:** `obj.locked` (existing `SceneObject` field); testids `keyframe-<id>-x-<t>`, `track-label-<id>`, `track-row-<id>`, `lock-<id>` (S19) all reused; the 6 diamonds each gain the identical `if (obj.locked) return;` first line. ✅
- **Placeholder scan:** every step has concrete code; the `.className).toMatch(/locked/)` assertion works with Vite's css-modules (readable-name prefix); the e2e mirrors the proven lock-object + keyframe-retime specs. ✅
