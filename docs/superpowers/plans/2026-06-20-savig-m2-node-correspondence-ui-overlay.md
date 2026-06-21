# Node-Correspondence Editor — Plan B2 (Stage Drag-Link Overlay) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "correspondence edit" sub-mode that ghosts both bracketing keyframes on the Stage, draws node→node links, lets the user drag to relink, flags crossing (non-order-preserving) links, and marks grow-from-point B nodes — so insertions and manual overrides are possible. Closes Feature 3.

**Architecture:** Pure-math overlay helpers in a new Stage-local module; a store flag + a `setCorrespondenceLink` action (seeds identity, sets one link, one undo step); a ghost `<g>` rendered on the Stage when editing; drag wiring that commits on pointer-release via refs (StrictMode-safe). Both keyframes' paths live in the same object-local path space, so they reuse the node-overlay transform — no per-keyframe CTM juggling.

**Tech Stack:** React 18 + TS (strict), Zustand, Vitest + RTL, Playwright (real chromium).

**Prerequisite:** Plan A (engine) and Plan B1 (Inspector nudge) merged. Uses `identityCorrespondence` from `src/engine`.

## Global Constraints

- **One undo step per relink** — `setCorrespondenceLink` routes through a single `get().commit(...)`.
- **Commit outside React setState updaters** — mirror Slice 2's `usePathTools` ref pattern; side effects inside updaters double-run under StrictMode (Slice 2 spawned ~109 dup objects this way).
- **Crossing links are flagged, not blocked** — the hard shift-instead-of-cross interaction is deferred; the user normalizes via Suggest/shift (Plan B1).
- **`-0` vs `+0`** — use `0 - x`, never `-x`.
- **Engine untouched** — overlay pure math lives under `src/ui/`.
- Tests: `pnpm vitest run <path>`; e2e `pnpm test:e2e <spec>` (match the repo's Playwright script name in `package.json`).

---

## File Structure

- `src/ui/store/store.ts` — `correspondenceEditing` flag, `enterCorrespondenceEdit`/`exitCorrespondenceEdit`, `setCorrespondenceLink` (MODIFY).
- `src/ui/store/store.test.ts` — store tests (MODIFY).
- `src/ui/components/Stage/correspondenceOverlay.ts` — NEW pure helpers: `isOrderPreserving`, `linkSegments`, `unreferencedTargets`.
- `src/ui/components/Stage/correspondenceOverlay.test.ts` — NEW unit test.
- `src/ui/components/Stage/Stage.tsx` — render the ghost overlay + drag wiring (MODIFY).
- `src/ui/components/Inspector/Inspector.tsx` — an "Edit links" toggle button in the Correspondence group (MODIFY).
- `e2e/correspondence.spec.ts` — NEW Playwright e2e (match existing `e2e/` layout).

---

## Task B2.1: Store — edit mode + `setCorrespondenceLink`

**Files:**
- Modify: `src/ui/store/store.ts` (interface near `:128` `requestCancelPen`; state near `:148`; impl near `:514`)
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Produces: `correspondenceEditing: boolean`
- Produces: `enterCorrespondenceEdit(): void`, `exitCorrespondenceEdit(): void`
- Produces: `setCorrespondenceLink(aIndex: number, bIndex: number): void`

- [ ] **Step 1: Write the failing test**

Add to `src/ui/store/store.test.ts`:

```ts
import { identityCorrespondence } from '../../engine';

function seedTwoShapeKfs() {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorPath({
    nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 5, y: 9 } }],
    closed: true,
  });
  s.addShapeKeyframe();
  s.seek(1);
  s.addShapeKeyframe();
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
  return id;
}

it('enter/exitCorrespondenceEdit toggles the flag', () => {
  seedTwoShapeKfs();
  useEditor.getState().enterCorrespondenceEdit();
  expect(useEditor.getState().correspondenceEditing).toBe(true);
  useEditor.getState().exitCorrespondenceEdit();
  expect(useEditor.getState().correspondenceEditing).toBe(false);
});

it('setCorrespondenceLink seeds identity then sets one link, one undo step', () => {
  seedTwoShapeKfs();
  const kf0 = () => useEditor.getState().history.present.objects[0].shapeTrack![0];
  const before = useEditor.getState().history.past.length;
  useEditor.getState().setCorrespondenceLink(2, 0); // a2 -> b0
  // n == 3 (to-path nodes); identity is [0,1,2], then c[2]=0 => [0,1,0].
  expect(kf0().correspondence).toEqual([0, 1, 0]);
  expect(useEditor.getState().history.past.length).toBe(before + 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/store/store.test.ts`
Expected: FAIL — actions/flag missing.

- [ ] **Step 3: Add flag + interface**

In the store interface, add near `requestCancelPen(): void;`:

```ts
  correspondenceEditing: boolean;
  enterCorrespondenceEdit(): void;
  exitCorrespondenceEdit(): void;
  setCorrespondenceLink(aIndex: number, bIndex: number): void;
```

In the initial state (near `penDrafting: false,`):

```ts
  correspondenceEditing: false,
```

- [ ] **Step 4: Implement the actions**

Add near `setSelectedShapeKeyframeCorrespondence` (import `identityCorrespondence` at the top of `store.ts` from `'../../engine'` if not already imported):

```ts
  enterCorrespondenceEdit() {
    set({ correspondenceEditing: true });
  },
  exitCorrespondenceEdit() {
    set({ correspondenceEditing: false });
  },
  setCorrespondenceLink(aIndex, bIndex) {
    const s = get();
    const ref = s.selectedShapeKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === ref.objectId);
    if (!obj?.shapeTrack) return;
    const idx = obj.shapeTrack.findIndex((k) => Math.abs(k.time - ref.time) < KF_EPS);
    if (idx < 0 || idx >= obj.shapeTrack.length - 1) return;
    const from = obj.shapeTrack[idx].path;
    const to = obj.shapeTrack[idx + 1].path;
    if (aIndex < 0 || aIndex >= from.nodes.length || bIndex < 0 || bIndex >= to.nodes.length) return;
    const cur = obj.shapeTrack[idx].correspondence ?? identityCorrespondence(from.nodes.length, to.nodes.length);
    const next = cur.slice();
    next[aIndex] = bIndex;
    const shapeTrack = obj.shapeTrack.map((k, i) => (i === idx ? { ...k, correspondence: next } : k));
    get().commit(replaceObject(project, { ...obj, shapeTrack }));
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/ui/store/store.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(store): correspondence edit mode + setCorrespondenceLink (seed identity, one undo)"
```

---

## Task B2.2: Pure overlay helpers

**Files:**
- Create: `src/ui/components/Stage/correspondenceOverlay.ts`
- Test: `src/ui/components/Stage/correspondenceOverlay.test.ts`

**Interfaces:**
- Produces: `isOrderPreserving(c: number[], n: number, closed: boolean): boolean`
- Produces: `unreferencedTargets(c: number[], n: number): number[]`
- Produces: `linkSegments(from: PathData, to: PathData, c: number[]): { ai: number; bi: number; ax: number; ay: number; bx: number; by: number }[]`

- [ ] **Step 1: Write the failing test**

Create `src/ui/components/Stage/correspondenceOverlay.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isOrderPreserving, unreferencedTargets, linkSegments } from './correspondenceOverlay';
import type { PathData } from '../../../engine';

const corner = (x: number, y: number) => ({ anchor: { x, y } });
const from: PathData = { nodes: [corner(0, 0), corner(10, 0), corner(5, 9)], closed: true };
const to: PathData = { nodes: [corner(0, 1), corner(10, 1), corner(5, 8)], closed: true };

describe('correspondenceOverlay helpers', () => {
  it('isOrderPreserving accepts rotations (closed)', () => {
    expect(isOrderPreserving([0, 1, 2], 3, true)).toBe(true);
    expect(isOrderPreserving([1, 2, 0], 3, true)).toBe(true); // cyclic shift
    expect(isOrderPreserving([2, 0, 1], 3, true)).toBe(true);
  });

  it('isOrderPreserving rejects a crossing (closed)', () => {
    expect(isOrderPreserving([0, 2, 1], 3, true)).toBe(false);
  });

  it('isOrderPreserving open requires non-decreasing', () => {
    expect(isOrderPreserving([0, 1, 2], 3, false)).toBe(true);
    expect(isOrderPreserving([0, 0, 1], 3, false)).toBe(true); // merge, still monotone
    expect(isOrderPreserving([1, 0, 2], 3, false)).toBe(false);
  });

  it('unreferencedTargets lists B nodes with no source', () => {
    expect(unreferencedTargets([0, 1], 3)).toEqual([2]);
    expect(unreferencedTargets([0, 1, 2], 3)).toEqual([]);
  });

  it('linkSegments maps anchor coordinates', () => {
    const segs = linkSegments(from, to, [1, 2, 0]);
    expect(segs).toHaveLength(3);
    expect(segs[0]).toMatchObject({ ai: 0, bi: 1, ax: 0, ay: 0, bx: 10, by: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/Stage/correspondenceOverlay.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the helpers**

Create `src/ui/components/Stage/correspondenceOverlay.ts`:

```ts
import type { PathData } from '../../../engine';

// True iff `c` is cyclic-order-preserving: a rotation/reflection of B's ring (closed) or
// a non-decreasing sequence (open), allowing equal consecutive values (adjacent merges).
export function isOrderPreserving(c: number[], n: number, closed: boolean): boolean {
  if (c.length === 0 || n === 0) return true;
  const nonDecreasing = (seq: number[]) => seq.every((v, i) => i === 0 || v >= seq[i - 1]);
  if (!closed) return nonDecreasing(c);
  // Closed: some rotation of c is non-decreasing in one of the two windings.
  const windings = [c, c.map((v) => n - 1 - v)];
  for (const w of windings) {
    for (let k = 0; k < w.length; k++) {
      const rot = w.slice(k).concat(w.slice(0, k));
      if (nonDecreasing(rot)) return true;
    }
  }
  return false;
}

export function unreferencedTargets(c: number[], n: number): number[] {
  const seen = new Set(c);
  const out: number[] = [];
  for (let j = 0; j < n; j++) if (!seen.has(j)) out.push(j);
  return out;
}

export function linkSegments(
  from: PathData,
  to: PathData,
  c: number[],
): { ai: number; bi: number; ax: number; ay: number; bx: number; by: number }[] {
  const out = [];
  for (let i = 0; i < c.length && i < from.nodes.length; i++) {
    const bi = c[i];
    if (bi < 0 || bi >= to.nodes.length) continue;
    const a = from.nodes[i].anchor;
    const b = to.nodes[bi].anchor;
    out.push({ ai: i, bi, ax: a.x, ay: a.y, bx: b.x, by: b.y });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/components/Stage/correspondenceOverlay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/correspondenceOverlay.ts src/ui/components/Stage/correspondenceOverlay.test.ts
git commit -m "feat(stage): pure correspondence-overlay helpers (order check, links, grow targets)"
```

---

## Task B2.3: Render the ghost overlay

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Modify: `src/ui/components/Inspector/Inspector.tsx` (Edit-links toggle)
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes: store `correspondenceEditing`, `selectedShapeKeyframe`; helpers from B2.2; `identityCorrespondence`.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/components/Stage/Stage.test.tsx` (mirror this file's existing Stage render setup — store seeding + `render(<Stage />)`):

```ts
it('renders the correspondence overlay with links and a grow marker when editing', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
  s.addShapeKeyframe();
  s.seek(1);
  // second keyframe with an extra node (so B has an unreferenced target)
  useEditor.getState().setPathData({
    nodes: [{ anchor: { x: 0, y: 1 } }, { anchor: { x: 10, y: 1 } }, { anchor: { x: 20, y: 1 } }],
    closed: false,
  });
  s.addShapeKeyframe();
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
  useEditor.getState().enterCorrespondenceEdit();
  render(<Stage />);

  expect(screen.getByTestId('correspondence-overlay')).toBeInTheDocument();
  // identity map [0,1] over 3 B nodes -> b2 unreferenced -> grow marker present.
  expect(screen.getByTestId('grow-target-2')).toBeInTheDocument();
  expect(screen.getByTestId('corr-link-0')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: FAIL — no `correspondence-overlay` testid.

- [ ] **Step 3: Compute overlay data in Stage**

In `src/ui/components/Stage/Stage.tsx`, add imports:

```ts
import { identityCorrespondence } from '../../../engine';
import { isOrderPreserving, unreferencedTargets, linkSegments } from './correspondenceOverlay';
```

Read state (near the other `useEditor((s) => …)` selectors):

```ts
  const correspondenceEditing = useEditor((s) => s.correspondenceEditing);
  const selectedShapeKeyframe = useEditor((s) => s.selectedShapeKeyframe);
```

Derive the overlay context (after `selectedPath` is resolved; reuse `selectedPath.transform` for the same object-local space):

```ts
  let corrOverlay: {
    from: PathData;
    to: PathData;
    map: number[];
    crossing: boolean;
    grow: number[];
    links: ReturnType<typeof linkSegments>;
  } | null = null;
  if (correspondenceEditing && selectedPath && selectedShapeKeyframe) {
    const o = objects.find((ob) => ob.id === selectedShapeKeyframe.objectId);
    const track = o?.shapeTrack;
    const idx = track ? track.findIndex((k) => Math.abs(k.time - selectedShapeKeyframe.time) < KF_EPS) : -1;
    if (track && idx >= 0 && idx < track.length - 1 && (track[idx].morph ?? 'corresponded') === 'corresponded') {
      const from = track[idx].path;
      const to = track[idx + 1].path;
      const map = track[idx].correspondence ?? identityCorrespondence(from.nodes.length, to.nodes.length);
      corrOverlay = {
        from,
        to,
        map,
        crossing: !isOrderPreserving(map, to.nodes.length, to.closed),
        grow: unreferencedTargets(map, to.nodes.length),
        links: linkSegments(from, to, map),
      };
    }
  }
```

(Use whatever `objects` / `KF_EPS` accessors already exist in `Stage.tsx`; if `KF_EPS` isn't defined here, add `const KF_EPS = 1e-6;` near the top as in Inspector.)

- [ ] **Step 4: Render the overlay group**

Inside the same transformed `<g>` that holds `node-overlay` (use `selectedPath.transform`), add after the `node-overlay` block:

```tsx
          {corrOverlay && (
            <g transform={selectedPath.transform} data-testid="correspondence-overlay">
              {/* ghost B nodes */}
              {corrOverlay.to.nodes.map((n, j) => (
                <circle
                  key={`b-${j}`}
                  data-testid={`corr-b-${j}`}
                  cx={n.anchor.x}
                  cy={n.anchor.y}
                  r={4 / zoom}
                  fill="none"
                  stroke="var(--color-text-muted)"
                  strokeWidth={1 / zoom}
                />
              ))}
              {/* grow-from-point markers (dashed) */}
              {corrOverlay.grow.map((j) => (
                <circle
                  key={`grow-${j}`}
                  data-testid={`grow-target-${j}`}
                  cx={corrOverlay!.to.nodes[j].anchor.x}
                  cy={corrOverlay!.to.nodes[j].anchor.y}
                  r={6 / zoom}
                  fill="none"
                  stroke="var(--color-text-muted)"
                  strokeWidth={1 / zoom}
                  strokeDasharray={`${2 / zoom} ${2 / zoom}`}
                />
              ))}
              {/* links */}
              {corrOverlay.links.map((s) => (
                <line
                  key={`link-${s.ai}`}
                  data-testid={`corr-link-${s.ai}`}
                  x1={s.ax}
                  y1={s.ay}
                  x2={s.bx}
                  y2={s.by}
                  stroke={corrOverlay!.crossing ? 'var(--color-danger)' : 'var(--color-accent)'}
                  strokeWidth={1.5 / zoom}
                />
              ))}
              {/* draggable A handles */}
              {corrOverlay.from.nodes.map((n, i) => (
                <rect
                  key={`a-${i}`}
                  data-testid={`corr-a-${i}`}
                  x={n.anchor.x - 4 / zoom}
                  y={n.anchor.y - 4 / zoom}
                  width={8 / zoom}
                  height={8 / zoom}
                  fill="var(--color-accent)"
                  style={{ cursor: 'grab' }}
                />
              ))}
            </g>
          )}
```

(If `--color-danger` / `--color-text-muted` tokens don't exist, reuse the nearest existing tokens — check `src/ui/theme` / the CSS token file — rather than inventing new ones.)

- [ ] **Step 5: Add the "Edit links" toggle in the Inspector**

In `src/ui/components/Inspector/Inspector.tsx`, inside the `kfCorr` control row (from Plan B1), add a toggle button and destructure the actions:

```tsx
                <button
                  type="button"
                  onClick={() =>
                    useEditor.getState().correspondenceEditing
                      ? useEditor.getState().exitCorrespondenceEdit()
                      : useEditor.getState().enterCorrespondenceEdit()
                  }
                >
                  Edit links
                </button>
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Inspector/Inspector.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(stage): correspondence ghost overlay (links, grow markers, crossing flag) + Edit-links toggle"
```

---

## Task B2.4: Drag-to-relink wiring

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes: `setCorrespondenceLink`; `corrOverlay` from B2.3.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/components/Stage/Stage.test.tsx`. The drag resolves the nearest B node to the pointer-up position; test the resolver via a direct interaction (pointerdown on an A handle, pointerup on a B node):

```ts
it('dragging A-handle 1 onto B-node 0 sets correspondence[1] = 0', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
  s.addShapeKeyframe();
  s.seek(1);
  s.addShapeKeyframe();
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
  useEditor.getState().enterCorrespondenceEdit();
  render(<Stage />);

  // The A handle starts a link drag; releasing over B node 0 commits the link.
  fireEvent.pointerDown(screen.getByTestId('corr-a-1'));
  fireEvent.pointerUp(screen.getByTestId('corr-b-0'));

  expect(useEditor.getState().history.present.objects[0].shapeTrack![0].correspondence).toEqual([0, 0]);
});
```

(Use this file's existing event utility — `fireEvent` from RTL, with the project's `PointerEvent` polyfill already loaded in test-setup.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: FAIL — handles have no drag handlers.

- [ ] **Step 3: Wire the drag (ref-based, commit on release)**

In `Stage.tsx`, add a ref for the in-flight drag source (near other refs):

```ts
  const corrDragRef = useRef<number | null>(null);
```

On each A `<rect>` (`corr-a-${i}`), add:

```tsx
                  onPointerDown={() => {
                    corrDragRef.current = i;
                  }}
```

On each B `<circle>` (`corr-b-${j}`), add `pointerEvents="all"` and:

```tsx
                  onPointerUp={() => {
                    const ai = corrDragRef.current;
                    corrDragRef.current = null;
                    if (ai !== null) useEditor.getState().setCorrespondenceLink(ai, j);
                  }}
```

The commit runs in the event handler (not inside a setState updater), so it is StrictMode-safe. `setCorrespondenceLink` already produces exactly one undo step (B2.1).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Full UI gate**

Run: `pnpm vitest run src/ui && pnpm typecheck && pnpm lint`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(stage): drag A-handle onto B-node to relink (commit on release, one undo)"
```

---

## Task B2.5: e2e — middle-insert no-roll + persistence

**Files:**
- Create: `e2e/correspondence.spec.ts` (match the existing `e2e/` morph spec layout)

**Interfaces:**
- Consumes: the full app (real chromium).

- [ ] **Step 1: Write the failing e2e**

Create `e2e/correspondence.spec.ts`, modeled on the existing morph e2e (`e2e/*morph*.spec.ts` — copy its app-boot, draw-path, add-shape-keyframe, and export helpers verbatim; only the correspondence steps below are new):

```ts
import { test, expect } from '@playwright/test';

test('correspondence Suggest fixes a rolling morph and persists across reload', async ({ page }) => {
  await page.goto('/');
  // 1. Create a closed path object and two shape keyframes that differ by a cyclic shift
  //    (reuse the morph spec's path-drawing + keyframe helpers).
  // 2. Select the first shape keyframe; open the Inspector Keyframe section.
  await page.getByRole('button', { name: 'Suggest correspondence' }).click();
  await expect(page.getByText(/suggested ·/)).toBeVisible();

  // 3. Reload; the autosave recovery should restore the correspondence.
  await page.reload();
  // re-select the first shape keyframe (reuse helper), then assert the summary still reads "suggested".
  await expect(page.getByText(/suggested ·/)).toBeVisible();

  // 4. Export and assert the animation runs without the index-pad roll:
  //    the mid-morph frame's path matches the suggested pairing (reuse the morph spec's
  //    export-and-read-bundle helper; assert the exported SVG path animates).
});
```

Fill in steps 1–4's helper calls by copying the existing morph e2e's utilities (do not invent new page objects). The assertions that must be present: the `suggested ·` summary appears, survives reload, and the exported bundle animates.

- [ ] **Step 2: Run e2e to verify it fails**

Run: `pnpm test:e2e e2e/correspondence.spec.ts`
Expected: FAIL — the flow/assertions aren't satisfied yet (or helpers need wiring).

- [ ] **Step 3: Make it pass**

Wire the helper calls so the flow runs end to end. No new app code should be required (B2.1–B2.4 + B1 provide everything); if the e2e reveals a gap, fix it in the relevant component and note it.

- [ ] **Step 4: Run e2e to verify it passes**

Run: `pnpm test:e2e e2e/correspondence.spec.ts`
Expected: PASS.

- [ ] **Step 5: Final full gate**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint && pnpm build && pnpm test:e2e`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add e2e/correspondence.spec.ts
git commit -m "test(e2e): correspondence Suggest fixes rolling morph, persists across reload"
```

---

## Plan B2 — Self-review checklist

- One undo step per relink? ✓ `setCorrespondenceLink` = single commit (B2.1 asserts).
- Commit outside setState updaters? ✓ drag commit runs in the pointer handler via `corrDragRef`.
- Crossing flagged not blocked? ✓ `isOrderPreserving` drives link color only.
- Grow-from-point legible? ✓ dashed `grow-target-${j}` markers (B2.3).
- Engine untouched? ✓ overlay helpers under `src/ui/`.
- e2e proves the headline fix + persistence? ✓ B2.5.
