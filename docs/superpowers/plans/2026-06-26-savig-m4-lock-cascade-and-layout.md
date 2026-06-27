# Group Lock Cascade + Layout Finishers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the next three clean M4 slices — (A) group LOCK cascade, (B) edge-align-to-artboard, (C) distribute by numeric spacing — each its own `--no-ff` merge with a review loop.

**Architecture:** Each slice mirrors an existing precedent. (A) adds `isLockedInTree`, a tree-walking cascade in `engine/groupTransform.ts` that mirrors `isRenderHidden`, then routes the INTERACTION-gating `.locked` sites through it (visual/own-state sites are left alone). (B)/(C) add pure geometry helpers to `Stage/align.ts` + store actions through the existing `alignItemsUpdates → setObjectsTransforms` pipeline + Inspector controls — the exact shape of the last three merged slices (`64fc78b`, `60ee73d`).

**Tech Stack:** TypeScript (strict), React 18, Zustand, Vitest (unit/RTL), Playwright (e2e), Vite, pnpm.

## Global Constraints

- TypeScript strict; no `any`. Pure engine helpers stay free of React/store imports.
- **Preview == export parity is sacred.** None of these slices may change `flattenInstances` / `computeFrame` / `renderSvgDocument` render output. Lock is editor-chrome + interaction gating only; align/distribute are layout ops through the existing autoKey-gated, root-scoped pipeline.
- Cascade helpers carry a `visited`/`seen` Set cycle guard (group-mediated cycles exist via symbols).
- Verify with `pnpm test` (unit), `pnpm test:e2e` (Playwright), `pnpm typecheck`, `pnpm lint` before each merge. Run `git log -1 --format=%H` after merge and record the hash + counts.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Each slice = its own branch off `main`, `--no-ff` merge after the review loop reports 0 Critical / 0 Important.

---

## SLICE A — Group LOCK cascade

**Why:** A child of a locked group is currently still editable (the `.locked` gates check only the object's own flag). Locking a group should make its whole subtree inert, mirroring how `isRenderHidden` cascades visibility (slice 45c/45e).

**Semantic triage — two classes of `.locked` site:**
- **OWN-state (LEAVE AS-IS):** the lock toggle action (`store.ts:945`), the LayersPanel lock icon + `aria-pressed` (`153/160`), the `.locked` row-CSS visual indicators (LayersPanel `76`, Timeline `95`), and the "don't select a locked clone" paste guard (`store.ts:674`). These describe or set the object's OWN lock; cascading them would be confusing (a child would show no lock icon yet be styled/treated as locked).
- **INTERACTION-gating (ROUTE THROUGH `isLockedInTree`):** can-I-select / drag / show-handles / keyframe / mutate. Listed per task below.
- **Top-level-only sites** (`store.ts:1406/1464`, Inspector `179`) already filter `!o.parentId`, so an ancestor lock is structurally impossible — cascade ≡ own. **Leave as-is** (no behavior change, avoids churn).

### Task A1: `isLockedInTree` engine helper

**Files:**
- Modify: `src/engine/groupTransform.ts` (add after `isRenderHidden`, ~line 31)
- Modify: `src/engine/index.ts` (export the new helper alongside `isRenderHidden`)
- Test: `src/engine/groupTransform.test.ts`

**Interfaces:**
- Produces: `isLockedInTree(obj: SceneObject, objectsById: Map<string, SceneObject>): boolean`

- [ ] **Step 1: Write the failing tests** in `src/engine/groupTransform.test.ts` (new `describe` block; reuse the existing `byId` helper pattern already in this file):

```ts
describe('isLockedInTree (lock cascade)', () => {
  const mk = (id: string, extra: Partial<SceneObject>): SceneObject =>
    ({ id, assetId: '', base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, anchorX: 0, anchorY: 0, zOrder: 0, ...extra }) as SceneObject;

  it('is true when the object itself is locked', () => {
    const o = mk('o', { locked: true });
    expect(isLockedInTree(o, new Map([['o', o]]))).toBe(true);
  });
  it('is false for an unlocked object with no group', () => {
    const o = mk('o', {});
    expect(isLockedInTree(o, new Map([['o', o]]))).toBe(false);
  });
  it('cascades from a locked parent group', () => {
    const g = mk('g', { isGroup: true, locked: true });
    const c = mk('c', { parentId: 'g' });
    expect(isLockedInTree(c, new Map([['g', g], ['c', c]]))).toBe(true);
  });
  it('cascades from a locked GRANDPARENT group', () => {
    const gp = mk('gp', { isGroup: true, locked: true });
    const p = mk('p', { isGroup: true, parentId: 'gp' });
    const c = mk('c', { parentId: 'p' });
    const map = new Map([['gp', gp], ['p', p], ['c', c]]);
    expect(isLockedInTree(c, map)).toBe(true);
    expect(isLockedInTree(p, map)).toBe(true);
  });
  it('is false when ancestors are unlocked', () => {
    const g = mk('g', { isGroup: true });
    const c = mk('c', { parentId: 'g' });
    expect(isLockedInTree(c, new Map([['g', g], ['c', c]]))).toBe(false);
  });
  it('terminates on a parentId cycle', () => {
    const a = mk('a', { isGroup: true, parentId: 'b' });
    const b = mk('b', { isGroup: true, parentId: 'a' });
    expect(isLockedInTree(a, new Map([['a', a], ['b', b]]))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- src/engine/groupTransform.test.ts`
Expected: FAIL — `isLockedInTree is not a function`.

- [ ] **Step 3: Implement** in `src/engine/groupTransform.ts` (insert after `isRenderHidden`, mirroring it exactly):

```ts
/** True when `obj` must be treated as locked for EDITING: it is locked, OR ANY ancestor group
 *  container is locked — group lock cascades down the whole chain (mirrors isRenderHidden). */
export function isLockedInTree(obj: SceneObject, objectsById: Map<string, SceneObject>): boolean {
  if (obj.locked) return true;
  const seen = new Set<string>();
  let pid = obj.parentId;
  while (pid && !seen.has(pid)) {
    seen.add(pid); // cycle guard
    const p = objectsById.get(pid);
    if (!p?.isGroup) break;
    if (p.locked) return true;
    pid = p.parentId;
  }
  return false;
}
```

Add to `src/engine/index.ts` wherever `isRenderHidden` is exported (same `export ... from './groupTransform'` line).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test -- src/engine/groupTransform.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/groupTransform.ts src/engine/index.ts src/engine/groupTransform.test.ts
git commit -m "feat(engine): isLockedInTree group lock cascade helper"
```

### Task A2: Route the STORE interaction gates

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `isLockedInTree` (Task A1). Import it from `'../../engine'` alongside the existing engine imports.

**Helper to add near the top of store.ts (after imports), to DRY the map construction:**

```ts
// Effective-lock cascade over a scene's objects (group lock → subtree). Builds the id map once.
function lockedInScene(objects: SceneObject[], obj: SceneObject): boolean {
  return isLockedInTree(obj, new Map(objects.map((o) => [o.id, o])));
}
```

**Sites to route (each `obj.locked` / `o.locked` → `lockedInScene(<scene>, <obj>)` using the scene already in scope):**

| Site | Current | Scene in scope | New |
|------|---------|----------------|-----|
| `duplicateSelected` (~612) | `.filter(o => !!o && !o.locked)` | `project.objects` (it reads root) | `.filter(o => !!o && !lockedInScene(project.objects, o))` |
| `deleteSelectedObject` (~877) | `return !!o && !o.locked;` | `objects` (= `selectActiveObjects(s)`) | `return !!o && !lockedInScene(objects, o);` |
| `setProperties` (~1789) | `if (!obj \|\| obj.locked) return;` | `objects` | `if (!obj \|\| lockedInScene(objects, obj)) return;` |
| `nudgeSelected`/bulk move (~1908) | `if (!obj \|\| obj.locked) continue;` | `objects` | `if (!obj \|\| lockedInScene(objects, obj)) continue;` |
| `setObjectsTransforms` (~1930) | `if (!obj \|\| obj.locked) continue;` | `objects` | `if (!obj \|\| lockedInScene(objects, obj)) continue;` |
| `alignItemsUpdates` (~512) | `if (!o \|\| o.locked \|\| o.hidden) continue;` | `project.objects` | `if (!o \|\| lockedInScene(project.objects, o) \|\| o.hidden) continue;` |

**LEAVE AS-IS (own-state / top-level-only):** `674` (locked clone select), `945` (lock toggle), `1406`/`1464` (`!o.parentId` top-level grouping). Build the `Map` ONCE per action where a loop touches many objects (hoist `const byId = new Map(...)` and inline `isLockedInTree(o, byId)` rather than calling `lockedInScene` in a hot loop) for `duplicateSelected`, `deleteSelectedObject`, `nudgeSelected`, `setObjectsTransforms`, `alignItemsUpdates`.

- [ ] **Step 1: Write the failing test** in `src/ui/store/store.test.ts` (new block). Use a fresh `useEditor.getState()` per read (never a stale snapshot):

```ts
describe('group lock cascade — store gates', () => {
  it('setObjectsTransforms skips a child of a locked group', () => {
    const s = useEditor.getState();
    s.reset?.(); // if a reset exists; else construct via existing test setup helpers
    // Build: a locked group G with child C (use the same scene-construction helpers other store tests use).
    // Select C, call setObjectsTransforms([{ id: C, x: 50 }]) with autoKey on.
    // Assert C.base.x (or its x track) is UNCHANGED because G is locked.
  });
});
```

> NOTE for implementer: match the existing store-test construction style in `store.test.ts` (they build a project via the store's create/add actions, then `useEditor.getState()` each read). Write the test concretely against that style; assert the child does NOT move when its parent group is locked, and DOES move when the group is unlocked (control case).

- [ ] **Step 2: Run to verify failure** — `pnpm test -- src/ui/store/store.test.ts` → FAIL (child moves today).
- [ ] **Step 3: Implement** the routing table above + the `lockedInScene` helper + import.
- [ ] **Step 4: Run to verify pass** — `pnpm test -- src/ui/store/store.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(store): route edit gates through isLockedInTree"`

### Task A3: Route the STAGE interaction gates

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: existing e2e `e2e/lock-object.spec.ts` extended (Step 1) — Stage interaction is e2e-tested.

**Map construction:** Stage already has the displayed scene's objects (the edit-scoped `project.objects`). Build `const lockById = new Map(project.objects.map(o => [o.id, o]))` in the component body (memoize: `useMemo(() => new Map(...), [project.objects])`) and use `isLockedInTree(obj, lockById)` at each gate. Line `1217` already has `mqById` — reuse it there.

**Sites to route (`*.locked` → `isLockedInTree(*, lockById)`):**
- Handle/overlay null-guards: `124, 140, 161, 195, 243, 255` (gradient/scale/rotate/anchor handle computations) — `obj.locked` → `isLockedInTree(obj, lockById)`.
- `624` pointer-down inert: `if (target?.locked)` → `if (target && isLockedInTree(target, lockById))`.
- `685`: `if (!o || o.locked)` → `if (!o || isLockedInTree(o, lockById))`.
- `791, 813` move/drag candidate filters: `!o.locked && !o.hidden` → `!isLockedInTree(o, lockById) && !o.hidden`.
- `1217` marquee: `!o.locked` → `!isLockedInTree(o, mqById)` (reuse `mqById`).
- `1723` motion overlay: `sel.locked` → `isLockedInTree(sel, lockById)`.
- `1880` dragOffset: `!o.locked` → `!isLockedInTree(o, lockById)`.

- [ ] **Step 1: Write the failing e2e** in `e2e/lock-object.spec.ts` (append a test): group two objects, lock the group via the Layers lock toggle, click a child on the Stage → assert it does NOT get selected (no selection handles / Inspector stays at multi-or-empty state); unlock → child selectable. Use selectors consistent with the existing lock-object/grouping specs.
- [ ] **Step 2: Run to verify failure** — `pnpm test:e2e -- lock-object` → FAIL (child selects today).
- [ ] **Step 3: Implement** the `lockById` memo + the routing above.
- [ ] **Step 4: Run to verify pass** — `pnpm test:e2e -- lock-object` → PASS. Also re-run `pnpm test:e2e -- marquee multi-move` (regressions).
- [ ] **Step 5: Commit** — `git commit -am "feat(stage): route Stage interaction gates through lock cascade"`

### Task A4: Route TIMELINE, INSPECTOR, LAYERSPANEL interaction gates

**Files:**
- Modify: `src/ui/components/Timeline/Timeline.tsx`, `src/ui/components/Inspector/Inspector.tsx`, `src/ui/components/LayersPanel/LayersPanel.tsx`
- Test: extend `e2e/lock-timeline.spec.ts` (timeline) + an RTL/e2e for LayersPanel drag-of-locked-child.

**Map construction:** each component builds `const lockById = useMemo(() => new Map(objects.map(o => [o.id, o])), [objects])` from the scene array it already maps over.

**Timeline.tsx** — keyframe-edit + select gates (LEAVE `95` row-CSS visual):
- `100` select: `if (!obj.locked) selectObject(obj.id)` → `if (!isLockedInTree(obj, lockById)) selectObject(obj.id)`.
- `120, 139, 160, 182, 201, 219` keyframe drag/edit gates: `if (obj.locked) return;` → `if (isLockedInTree(obj, lockById)) return;`.

**Inspector.tsx:**
- `163` movable-for-align predicate: `o && !o.locked && !o.hidden` → `o && !isLockedInTree(o, lockById) && !o.hidden`. Build `lockById` from the same `objects` source this predicate iterates (`selectActiveObjects`).
- `457` Create Symbol button: `disabled={obj.locked}` → `disabled={isLockedInTree(obj, lockById)}`.
- LEAVE `179` (`!o.parentId` top-level-only).

**LayersPanel.tsx** — gate drag + click-select (LEAVE `76` row-CSS, `153/160` icon/aria own-state):
- `78` draggable: `draggable={!o.locked && editingId !== o.id}` → `draggable={!isLockedInTree(o, lockById) && editingId !== o.id}`.
- `80` row click: `if (o.locked) return;` → `if (isLockedInTree(o, lockById)) return;`.

- [ ] **Step 1: Write the failing test** — extend `e2e/lock-timeline.spec.ts`: child of a locked group → its timeline row keyframe drag is inert; control (unlocked group) works.
- [ ] **Step 2: Run to verify failure** — `pnpm test:e2e -- lock-timeline` → FAIL.
- [ ] **Step 3: Implement** the three components' routing.
- [ ] **Step 4: Run to verify pass** — `pnpm test:e2e -- lock-timeline layers-panel`; `pnpm test` (RTL for Inspector/Layers).
- [ ] **Step 5: Commit** — `git commit -am "feat(ui): route Timeline/Inspector/Layers gates through lock cascade"`

### Task A5: Full verify + review loop + merge (Slice A)

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` — all green; record counts.
- [ ] Dispatch `feature-dev:code-reviewer` on the branch diff. Focus prompts: (1) every routed site reads the SAME scene it writes; (2) no own-state/visual site was wrongly cascaded; (3) cycle guard; (4) parity untouched (no engine-render change); (5) map built once per action, not per-iteration in hot loops.
- [ ] Resolve all Critical/Important; **re-run the reviewer until 0 Critical / 0 Important.** (Use superpowers:receiving-code-review — verify each suggestion before applying.)
- [ ] `git checkout main && git merge --no-ff` the slice. Record the merge hash + test counts. Update INDEX.md.

---

## SLICE B — Edge-align-to-artboard

**Why:** `computeAlign` aligns objects to EACH OTHER; `computeCenterOnFrame` centers the selection on the artboard. There is no per-EDGE align to the artboard (left/right/top/bottom/h-center/v-center to the frame). This adds it, reusing the align family.

### Task B1: `computeAlignToFrame` pure helper

**Files:**
- Modify: `src/ui/components/Stage/align.ts`
- Test: `src/ui/components/Stage/align.test.ts`

**Interfaces:**
- Produces: `computeAlignToFrame(items: AlignItem[], edge: AlignEdge, frameW: number, frameH: number): { id: string; x?: number; y?: number }[]`

- [ ] **Step 1: Write the failing tests** in `align.test.ts`:

```ts
describe('computeAlignToFrame (align to artboard)', () => {
  const item = (id: string, minX: number, minY: number, w: number, h: number, x: number, y: number): AlignItem =>
    ({ id, aabb: { minX, minY, maxX: minX + w, maxY: minY + h }, x, y });

  it('aligns left edges to x=0', () => {
    const out = computeAlignToFrame([item('a', 10, 0, 20, 20, 10, 0)], 'left', 100, 100);
    expect(out).toEqual([{ id: 'a', x: 0 }]); // d = 0 - 10 = -10 → x = 10 + (-10) = 0
  });
  it('aligns right edges to x=frameW', () => {
    const out = computeAlignToFrame([item('a', 0, 0, 20, 20, 0, 0)], 'right', 100, 100);
    expect(out).toEqual([{ id: 'a', x: 80 }]); // d = 100 - 20 = 80
  });
  it('aligns horizontal centers to frameW/2', () => {
    const out = computeAlignToFrame([item('a', 0, 0, 20, 20, 0, 0)], 'hcenter', 100, 100);
    expect(out).toEqual([{ id: 'a', x: 40 }]); // center 10 → 50, d = 40
  });
  it('aligns top to y=0', () => {
    const out = computeAlignToFrame([item('a', 0, 10, 20, 20, 0, 10)], 'top', 100, 100);
    expect(out).toEqual([{ id: 'a', y: 0 }]);
  });
  it('aligns bottom to y=frameH and vcenter to frameH/2', () => {
    expect(computeAlignToFrame([item('a', 0, 0, 20, 20, 0, 0)], 'bottom', 100, 100)).toEqual([{ id: 'a', y: 80 }]);
    expect(computeAlignToFrame([item('a', 0, 0, 20, 20, 0, 0)], 'vcenter', 100, 100)).toEqual([{ id: 'a', y: 40 }]);
  });
  it('operates per-item (each object aligns to the frame, not to the group)', () => {
    const out = computeAlignToFrame([item('a', 0, 0, 10, 10, 0, 0), item('b', 50, 0, 10, 10, 50, 0)], 'left', 100, 100);
    expect(out).toEqual([{ id: 'b', x: 0 }]); // a already at 0 → filtered by EPS; b moves to 0
  });
  it('returns [] for no items and skips no-op deltas', () => {
    expect(computeAlignToFrame([], 'left', 100, 100)).toEqual([]);
    expect(computeAlignToFrame([item('a', 0, 0, 20, 20, 0, 0)], 'left', 100, 100)).toEqual([]); // already at 0
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm test -- src/ui/components/Stage/align.test.ts` → FAIL.
- [ ] **Step 3: Implement** in `align.ts` (after `computeCenterOnFrame`):

```ts
/** Align each item's `edge` to the ARTBOARD frame (not to the group bbox): left→0, right→frameW,
 *  hcenter→frameW/2, top→0, bottom→frameH, vcenter→frameH/2. Per-item delta; >=1 item. */
export function computeAlignToFrame(
  items: AlignItem[],
  edge: AlignEdge,
  frameW: number,
  frameH: number,
): { id: string; x?: number; y?: number }[] {
  const horizontal = edge === 'left' || edge === 'hcenter' || edge === 'right';
  const out: { id: string; x?: number; y?: number }[] = [];
  for (const it of items) {
    const a = it.aabb;
    let d: number;
    if (edge === 'left') d = 0 - a.minX;
    else if (edge === 'right') d = frameW - a.maxX;
    else if (edge === 'hcenter') d = frameW / 2 - (a.minX + a.maxX) / 2;
    else if (edge === 'top') d = 0 - a.minY;
    else if (edge === 'bottom') d = frameH - a.maxY;
    else d = frameH / 2 - (a.minY + a.maxY) / 2; // vcenter
    if (Math.abs(d) < EPS) continue;
    out.push(horizontal ? { id: it.id, x: it.x + d } : { id: it.id, y: it.y + d });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm test -- src/ui/components/Stage/align.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(align): computeAlignToFrame edge-align-to-artboard helper"`

### Task B2: `alignToCanvas` store action

**Files:**
- Modify: `src/ui/store/store.ts` (interface ~line 285 near `centerOnCanvas`; impl ~line 1955)
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `computeAlignToFrame` (B1), `AlignEdge`, the existing `alignItemsUpdates`/`setObjectsTransforms`.
- Produces: `alignToCanvas(edge: AlignEdge): void` on `EditorState`.

- [ ] **Step 1: Write the failing test** in `store.test.ts` (mirror the `centerOnCanvas` test): place one object off-edge, `alignToCanvas('left')` with autoKey on → its x track / base lands so minX = 0. Use fresh `useEditor.getState()` per read.
- [ ] **Step 2: Run to verify failure** — FAIL (`alignToCanvas is not a function`).
- [ ] **Step 3: Implement.** Interface line near `centerOnCanvas(): void;`:

```ts
  alignToCanvas(edge: AlignEdge): void;
```

Impl near `centerOnCanvas` (~1955):

```ts
  alignToCanvas(edge) {
    const { width, height } = get().history.present.meta;
    const updates = alignItemsUpdates(get(), (items) => computeAlignToFrame(items, edge, width, height));
    if (updates.length) get().setObjectsTransforms(updates);
  },
```

(Import `computeAlignToFrame` from `'../components/Stage/align'` alongside the existing align imports.)

- [ ] **Step 4: Run to verify pass** — PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(store): alignToCanvas action"`

### Task B3: Inspector edge-align-to-artboard buttons

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx`
- Test: `src/ui/components/Inspector/Inspector.test.tsx` + `e2e/align-distribute.spec.ts`

**Design:** Six buttons next to the existing "Center on canvas" (⊡) in BOTH the multi-select panel (~195) and the single-object panel (~458). Like center-on-canvas, edge-align-to-artboard works for a single object too (no `canAlign` gate — aligning ONE object to the frame is valid). Labels use distinct glyphs to avoid clashing with the object-to-object align glyphs.

- [ ] **Step 1: Write the failing test** — RTL: render Inspector with a selection, click `aria-label="Align left to canvas"` → assert `alignToCanvas` called with `'left'` (spy the store action) OR assert the object's x updates. Add an e2e in `align-distribute.spec.ts`: object near center, click "Align left to canvas", assert it snaps to the left edge.
- [ ] **Step 2: Run to verify failure** — FAIL (button not found).
- [ ] **Step 3: Implement.** Pull `alignToCanvas` from the store (next to `centerOnCanvas` at ~128). Add after the `centerOnCanvas` button in BOTH panels:

```tsx
          <button aria-label="Align left to canvas" title="Align left to canvas" onClick={() => alignToCanvas('left')}>⊣</button>
          <button aria-label="Align horizontal center to canvas" title="Align horizontal center to canvas" onClick={() => alignToCanvas('hcenter')}>⊢⊣</button>
          <button aria-label="Align right to canvas" title="Align right to canvas" onClick={() => alignToCanvas('right')}>⊢</button>
          <button aria-label="Align top to canvas" title="Align top to canvas" onClick={() => alignToCanvas('top')}>⊤</button>
          <button aria-label="Align vertical center to canvas" title="Align vertical center to canvas" onClick={() => alignToCanvas('vcenter')}>⊤⊥</button>
          <button aria-label="Align bottom to canvas" title="Align bottom to canvas" onClick={() => alignToCanvas('bottom')}>⊥</button>
```

> NOTE: if the multi-vs-single panel `aria-label`s would collide for e2e strict-mode, keep them identical (both panels never render simultaneously — only one object-count state shows at a time). Use `exact: true` in any e2e `getByRole(name)` to avoid substring ambiguity (lesson from `ad8923a`).

- [ ] **Step 4: Run to verify pass** — `pnpm test -- Inspector`; `pnpm test:e2e -- align-distribute`.
- [ ] **Step 5: Commit** — `git commit -am "feat(inspector): align-to-canvas edge buttons"`

### Task B4: Verify + review loop + merge (Slice B)

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` green; record counts.
- [ ] `feature-dev:code-reviewer` on the diff (focus: per-item delta geometry, family consistency with center-on-canvas, autoKey-gate/root-scope inheritance, parity). Re-review until 0 Crit / 0 Important.
- [ ] `--no-ff` merge to main; record hash + counts; update INDEX.md.

---

## SLICE C — Distribute by numeric spacing

**Why:** `computeDistribute` (equal gap) and `computeDistributeCenters` (equal centers) both DERIVE the spacing from the selection's extent. There is no way to set an EXACT pixel gap. This adds a numeric-spacing distribute: keep the first item (by position) fixed, place each subsequent item so consecutive GAPS equal a user-supplied value.

### Task C1: `computeDistributeSpacing` pure helper

**Files:**
- Modify: `src/ui/components/Stage/align.ts`
- Test: `src/ui/components/Stage/align.test.ts`

**Interfaces:**
- Produces: `computeDistributeSpacing(items: AlignItem[], axis: DistributeAxis, gap: number): { id: string; x?: number; y?: number }[]`

- [ ] **Step 1: Write the failing tests**:

```ts
describe('computeDistributeSpacing (numeric gap)', () => {
  const item = (id: string, lo: number, size: number, pos: number): AlignItem =>
    ({ id, aabb: { minX: lo, minY: 0, maxX: lo + size, maxY: 10 }, x: pos, y: 0 });

  it('places consecutive items with an exact gap (horizontal), first fixed', () => {
    // a: lo 0 size 10; b: lo 100 size 10; c: lo 200 size 20. gap=5.
    // cursor: a stays @0; b → 15; c → 30.
    const out = computeDistributeSpacing(
      [item('a', 0, 10, 0), item('b', 100, 10, 100), item('c', 200, 20, 200)], 'h', 5);
    expect(out).toEqual([{ id: 'b', x: 15 }, { id: 'c', x: 30 }]); // a filtered (d=0)
  });
  it('supports a zero gap (touching)', () => {
    const out = computeDistributeSpacing([item('a', 0, 10, 0), item('b', 50, 10, 50)], 'h', 0);
    expect(out).toEqual([{ id: 'b', x: 10 }]);
  });
  it('works vertically (uses minY/maxY and y)', () => {
    const v = (id: string, lo: number, size: number, pos: number): AlignItem =>
      ({ id, aabb: { minX: 0, minY: lo, maxX: 10, maxY: lo + size }, x: 0, y: pos });
    const out = computeDistributeSpacing([v('a', 0, 10, 0), v('b', 80, 10, 80)], 'v', 20);
    expect(out).toEqual([{ id: 'b', y: 30 }]); // cursor after a = 10 + 20 = 30
  });
  it('returns [] for fewer than 2 items', () => {
    expect(computeDistributeSpacing([item('a', 0, 10, 0)], 'h', 5)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL.
- [ ] **Step 3: Implement** in `align.ts` (after `computeDistribute`):

```ts
/** Distribute by an EXACT pixel `gap` between consecutive boxes along `axis`. The first item
 *  (by lo edge) stays fixed; each subsequent box is placed `gap` after the previous box's hi edge.
 *  Needs >=2 items. (Complements computeDistribute's derived gap.) */
export function computeDistributeSpacing(
  items: AlignItem[],
  axis: DistributeAxis,
  gap: number,
): { id: string; x?: number; y?: number }[] {
  if (items.length < 2) return [];
  const horizontal = axis === 'h';
  const lo = (a: AABB) => (horizontal ? a.minX : a.minY);
  const hi = (a: AABB) => (horizontal ? a.maxX : a.maxY);
  const sorted = [...items].sort((p, q) => lo(p.aabb) - lo(q.aabb));
  const out: { id: string; x?: number; y?: number }[] = [];
  let cursor = lo(sorted[0].aabb);
  for (const it of sorted) {
    const d = cursor - lo(it.aabb);
    if (Math.abs(d) >= EPS) out.push(horizontal ? { id: it.id, x: it.x + d } : { id: it.id, y: it.y + d });
    cursor += hi(it.aabb) - lo(it.aabb) + gap;
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass** — PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(align): computeDistributeSpacing numeric-gap helper"`

### Task C2: `distributeSpacingSelected` store action

**Files:**
- Modify: `src/ui/store/store.ts` (interface near `distributeCentersSelected` ~283; impl ~1951)
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Produces: `distributeSpacingSelected(axis: DistributeAxis, gap: number): void`

- [ ] **Step 1: Write the failing test** — mirror `distributeCentersSelected`: 3 objects, `distributeSpacingSelected('h', 5)` → middle/last objects land at the exact gapped positions. Fresh `getState()` per read.
- [ ] **Step 2: Run to verify failure** — FAIL.
- [ ] **Step 3: Implement.** Interface:

```ts
  distributeSpacingSelected(axis: DistributeAxis, gap: number): void;
```

Impl (near `distributeCentersSelected`):

```ts
  distributeSpacingSelected(axis, gap) {
    const updates = alignItemsUpdates(get(), (items) => computeDistributeSpacing(items, axis, gap));
    if (updates.length) get().setObjectsTransforms(updates);
  },
```

(Import `computeDistributeSpacing` alongside the other align imports.)

- [ ] **Step 4: Run to verify pass** — PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(store): distributeSpacingSelected action"`

### Task C3: Inspector numeric-spacing input + buttons

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx`
- Test: `src/ui/components/Inspector/Inspector.test.tsx` + `e2e/align-distribute.spec.ts`

**Design:** In the multi-select panel, next to the distribute buttons, add a numeric input (local React state, default `10`) + two buttons (H / V) calling `distributeSpacingSelected(axis, spacing)`. Gate by the existing `canDistribute` (movable ≥ 3) for consistency with the other distribute buttons — though the helper allows ≥2, keep UI parity with the distribute family; document the choice.

- [ ] **Step 1: Write the failing test** — RTL: set the spacing input to `5`, click `aria-label="Distribute horizontal spacing"` → assert `distributeSpacingSelected('h', 5)`. e2e: three objects, set spacing, click → exact positions.
- [ ] **Step 2: Run to verify failure** — FAIL.
- [ ] **Step 3: Implement.** Add local state at the top of the Inspector component body:

```tsx
  const [spacing, setSpacing] = useState(10);
```

Pull `distributeSpacingSelected` from the store. After the distribute buttons (~194) in the multi-select panel:

```tsx
          <input
            type="number"
            aria-label="Distribute spacing value"
            value={spacing}
            onChange={(e) => setSpacing(Number(e.target.value) || 0)}
            style={{ width: '4em' }}
          />
          <button aria-label="Distribute horizontal spacing" title="Distribute horizontal spacing" disabled={!canDistribute} onClick={() => distributeSpacingSelected('h', spacing)}>↦</button>
          <button aria-label="Distribute vertical spacing" title="Distribute vertical spacing" disabled={!canDistribute} onClick={() => distributeSpacingSelected('v', spacing)}>↧</button>
```

(Ensure `useState` is imported in Inspector.tsx — it almost certainly already is.)

- [ ] **Step 4: Run to verify pass** — `pnpm test -- Inspector`; `pnpm test:e2e -- align-distribute`.
- [ ] **Step 5: Commit** — `git commit -am "feat(inspector): numeric-spacing distribute input"`

### Task C4: Verify + review loop + merge (Slice C)

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` green; record counts.
- [ ] `feature-dev:code-reviewer` (focus: cursor math, first-fixed semantics, ≥2 vs `canDistribute`≥3 UI choice, family consistency, parity). Re-review until 0 Crit / 0 Important.
- [ ] `--no-ff` merge; record hash + counts; update INDEX.md (move all three slices into the merged table, prune from backlog).

---

## Self-Review (run after writing, before executing)

**Spec coverage:**
- Lock cascade — helper (A1) + all interaction-gate classes (store A2, Stage A3, Timeline/Inspector/Layers A4) covered; own-state/top-level sites explicitly LEFT (triage table). ✓
- Edge-align-to-artboard — helper (B1) + action (B2) + UI (B3). ✓
- Numeric spacing distribute — helper (C1) + action (C2) + UI (C3). ✓

**Placeholder scan:** Store-test bodies (A2 Step 1, B2, C2) are described against the existing `store.test.ts` construction style rather than literal because that style isn't quoted here — the implementer must match the file's existing helpers; the ASSERTIONS are concrete (child doesn't move / lands at exact px). All pure-helper tests are literal. Acceptable: these are test-DESIGN directives with concrete pass criteria, not implementation placeholders.

**Type consistency:** `isLockedInTree(obj, Map)` used identically in A2–A4. `computeAlignToFrame(items, edge, frameW, frameH)` / `alignToCanvas(edge)` consistent B1↔B2↔B3. `computeDistributeSpacing(items, axis, gap)` / `distributeSpacingSelected(axis, gap)` consistent C1↔C2↔C3. `AlignEdge`/`DistributeAxis`/`AlignItem`/`AABB`/`EPS` all already exported from `align.ts`/`snapping.ts`. ✓
