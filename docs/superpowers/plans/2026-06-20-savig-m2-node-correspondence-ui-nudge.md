# Node-Correspondence Editor — Plan B1 (Inspector Nudge UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Correspondence" group to the Inspector Keyframe section — a one-click **Suggest** plus **shift**/**reverse** nudges — that authors `correspondence` on the selected shape keyframe's outbound transition. This is the shippable rolling-morph fix; no Stage canvas required.

**Architecture:** Pure UI over Plan A's engine. A new store action `setSelectedShapeKeyframeCorrespondence` mirrors `setSelectedShapeKeyframeMorph`. The Inspector renders the group only for a shape keyframe that is in `corresponded` mode and has a *next* keyframe (a real transition), wiring buttons to `suggestCorrespondence` / `shiftCorrespondence` / `reverseCorrespondence` from the engine barrel.

**Tech Stack:** React 18 + TS (strict), Zustand, Vitest + React Testing Library + `@testing-library/user-event`.

**Prerequisite:** Plan A (engine) merged — `correspondence` field, `suggestCorrespondence`, `shiftCorrespondence`, `reverseCorrespondence`, `identityCorrespondence` exported from `src/engine`.

## Global Constraints

- **One undo step per user gesture** — each click routes through `get().commit(...)` (single history entry).
- **Optional field** — `undefined` clears back to identity; never write an empty/invalid map.
- **Corresponded mode only** — the group is hidden under `resampled` and for the last keyframe (no outbound transition).
- **Closed-only shift** — the `shift ◀ ▶` controls render only for closed paths (open paths have no valid cyclic shift); `reverse` renders for both.
- Tests: `pnpm vitest run <path>`; typecheck `pnpm typecheck`.

---

## File Structure

- `src/ui/store/store.ts` — add `setSelectedShapeKeyframeCorrespondence` to the interface + implementation (MODIFY).
- `src/ui/store/store.test.ts` — store action test (MODIFY).
- `src/ui/components/Inspector/Inspector.tsx` — Correspondence group + wiring (MODIFY).
- `src/ui/components/Inspector/Inspector.module.css` — minor row styling reuse (MODIFY if needed; reuse existing `.row`/`.group`).
- `src/ui/components/Inspector/Inspector.test.tsx` — RTL tests (MODIFY).

---

## Task B1.1: Store action `setSelectedShapeKeyframeCorrespondence`

**Files:**
- Modify: `src/ui/store/store.ts:115` (interface) and `:476` (implementation, after `setSelectedShapeKeyframeMorph`)
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Produces: `setSelectedShapeKeyframeCorrespondence(correspondence: number[] | undefined): void`

- [ ] **Step 1: Write the failing test**

Add to `src/ui/store/store.test.ts` (mirror the existing shape-keyframe test setup in this file — `newProject` / `addVectorPath` / `addShapeKeyframe` / `selectShapeKeyframe`):

```ts
it('setSelectedShapeKeyframeCorrespondence writes (and clears) the map on the selected shape keyframe, one undo step', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorPath({
    nodes: [
      { anchor: { x: 0, y: 0 } },
      { anchor: { x: 10, y: 0 } },
      { anchor: { x: 10, y: 10 } },
      { anchor: { x: 0, y: 10 } },
    ],
    closed: true,
  });
  s.addShapeKeyframe();
  s.seek(1);
  s.addShapeKeyframe();
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });

  const before = useEditor.getState().history.past.length;
  useEditor.getState().setSelectedShapeKeyframeCorrespondence([1, 2, 3, 0]);
  const kf0 = () => useEditor.getState().history.present.objects[0].shapeTrack![0];
  expect(kf0().correspondence).toEqual([1, 2, 3, 0]);
  expect(useEditor.getState().history.past.length).toBe(before + 1); // exactly one undo step

  useEditor.getState().undo();
  expect(kf0().correspondence).toBeUndefined();

  useEditor.getState().redo();
  useEditor.getState().setSelectedShapeKeyframeCorrespondence(undefined);
  expect(kf0().correspondence).toBeUndefined();
});
```

(If `history.past` is named differently in this store, use the same property the existing one-undo-step tests assert against; check a neighboring `setSelected*` test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/store/store.test.ts`
Expected: FAIL — `setSelectedShapeKeyframeCorrespondence` is not a function.

- [ ] **Step 3: Add to the interface**

In `src/ui/store/store.ts`, after `setSelectedShapeKeyframeMorph(mode: MorphMode): void;`:

```ts
  setSelectedShapeKeyframeCorrespondence(correspondence: number[] | undefined): void;
```

- [ ] **Step 4: Implement the action**

In `src/ui/store/store.ts`, immediately after the `setSelectedShapeKeyframeMorph(mode) { ... }` implementation:

```ts
  setSelectedShapeKeyframeCorrespondence(correspondence) {
    const s = get();
    const ref = s.selectedShapeKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === ref.objectId);
    if (!obj?.shapeTrack) return;
    const shapeTrack = obj.shapeTrack.map((k) =>
      Math.abs(k.time - ref.time) < KF_EPS ? { ...k, correspondence } : k,
    );
    get().commit(replaceObject(project, { ...obj, shapeTrack }));
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/ui/store/store.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(store): setSelectedShapeKeyframeCorrespondence (per-keyframe node map)"
```

---

## Task B1.2: Inspector "Correspondence" group — Suggest + summary

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx`
- Test: `src/ui/components/Inspector/Inspector.test.tsx`

**Interfaces:**
- Consumes: `setSelectedShapeKeyframeCorrespondence`, `suggestCorrespondence`.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/components/Inspector/Inspector.test.tsx`:

```ts
import { suggestCorrespondence } from '../../../engine';

it('shows Suggest for a corresponded shape keyframe with a next keyframe and writes the map', async () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorPath({
    nodes: [
      { anchor: { x: 0, y: 0 } },
      { anchor: { x: 10, y: 0 } },
      { anchor: { x: 10, y: 10 } },
      { anchor: { x: 0, y: 10 } },
    ],
    closed: true,
  });
  s.addShapeKeyframe();
  s.seek(1);
  s.addShapeKeyframe();
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
  render(<Inspector />);

  const btn = screen.getByRole('button', { name: 'Suggest correspondence' });
  await userEvent.click(btn);

  const track = useEditor.getState().history.present.objects[0].shapeTrack!;
  expect(track[0].correspondence).toEqual(suggestCorrespondence(track[0].path, track[1].path));
  expect(screen.getByText(/suggested · 4 nodes/)).toBeInTheDocument();
});

it('hides the Correspondence group for the last shape keyframe (no transition)', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
  s.addShapeKeyframe();
  s.seek(1);
  s.addShapeKeyframe();
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectShapeKeyframe({ objectId: id, time: 1 }); // last kf
  render(<Inspector />);
  expect(screen.queryByRole('button', { name: 'Suggest correspondence' })).toBeNull();
});

it('hides the Correspondence group under resampled mode', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
  s.addShapeKeyframe();
  s.seek(1);
  s.addShapeKeyframe();
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
  useEditor.getState().setSelectedShapeKeyframeMorph('resampled');
  render(<Inspector />);
  expect(screen.queryByRole('button', { name: 'Suggest correspondence' })).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx`
Expected: FAIL — no "Suggest correspondence" button.

- [ ] **Step 3: Compute the correspondence context**

In `src/ui/components/Inspector/Inspector.tsx`:

(a) Extend the imports:

```ts
import { sampleObject, snapToFrame, suggestCorrespondence, shiftCorrespondence, reverseCorrespondence, identityCorrespondence } from '../../../engine';
import type { Easing, MorphMode, RotationMode, PathData } from '../../../engine';
```

(b) Destructure the new action (next to `setSelectedShapeKeyframeMorph`):

```ts
    setSelectedShapeKeyframeMorph,
    setSelectedShapeKeyframeCorrespondence,
  } = useEditor.getState();
```

(c) Add a module-level summary helper (above the component, near `round`):

```ts
function correspondenceSummary(map: number[] | undefined, from: PathData, to: PathData): string {
  const n = to.nodes.length;
  if (!map) return `auto · ${n} nodes`;
  const suggested = suggestCorrespondence(from, to);
  const eq = map.length === suggested.length && map.every((v, i) => v === suggested[i]);
  return `${eq ? 'suggested' : 'custom'} · ${n} nodes`;
}
```

(d) In the shape-keyframe resolution block (the `if (selectedShapeKeyframe && … && obj.shapeTrack)` block, inside `if (idx >= 0)`), add a correspondence context next to `kfMorph`:

```ts
  let kfCorr: { from: PathData; to: PathData; map: number[] | undefined } | null = null;
```

Declare `kfCorr` alongside the other `kf*` lets (with `kfMorph`), then inside `if (idx >= 0)`:

```ts
      if (idx < track.length - 1 && (track[idx].morph ?? 'corresponded') === 'corresponded') {
        kfCorr = { from: track[idx].path, to: track[idx + 1].path, map: track[idx].correspondence };
      }
```

- [ ] **Step 4: Render the group**

In the Keyframe section JSX, after the `{kfMorph !== null && ( … )}` block and before the closing `</>`:

```tsx
          {kfCorr && (
            <div className={styles.row}>
              <span>correspondence</span>
              <button
                type="button"
                onClick={() =>
                  setSelectedShapeKeyframeCorrespondence(
                    suggestCorrespondence(kfCorr!.from, kfCorr!.to),
                  )
                }
              >
                Suggest correspondence
              </button>
              <span>{correspondenceSummary(kfCorr.map, kfCorr.from, kfCorr.to)}</span>
            </div>
          )}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx && pnpm typecheck`
Expected: PASS (all three new cases + existing Inspector tests).

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/Inspector/Inspector.tsx src/ui/components/Inspector/Inspector.test.tsx
git commit -m "feat(inspector): Correspondence group — Suggest + summary (corresponded, non-last only)"
```

---

## Task B1.3: shift / reverse nudge controls

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx`
- Test: `src/ui/components/Inspector/Inspector.test.tsx`

**Interfaces:**
- Consumes: `shiftCorrespondence`, `reverseCorrespondence`, `identityCorrespondence`.

- [ ] **Step 1: Write the failing tests**

Add to `src/ui/components/Inspector/Inspector.test.tsx`:

```ts
it('shift forward rotates the map; closed path shows shift controls', async () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorPath({
    nodes: [
      { anchor: { x: 0, y: 0 } },
      { anchor: { x: 10, y: 0 } },
      { anchor: { x: 10, y: 10 } },
      { anchor: { x: 0, y: 10 } },
    ],
    closed: true,
  });
  s.addShapeKeyframe();
  s.seek(1);
  s.addShapeKeyframe();
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
  render(<Inspector />);

  // Seed identity via Suggest (square->square => [0,1,2,3]), then shift forward => [1,2,3,0].
  await userEvent.click(screen.getByRole('button', { name: 'Suggest correspondence' }));
  await userEvent.click(screen.getByRole('button', { name: 'Shift correspondence forward' }));
  expect(useEditor.getState().history.present.objects[0].shapeTrack![0].correspondence).toEqual([
    1, 2, 3, 0,
  ]);
});

it('reverse flips winding; open path hides shift but shows reverse', async () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorPath({
    nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 20, y: 0 } }],
    closed: false,
  });
  s.addShapeKeyframe();
  s.seek(1);
  s.addShapeKeyframe();
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
  render(<Inspector />);

  expect(screen.queryByRole('button', { name: 'Shift correspondence forward' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Reverse correspondence winding' }));
  // identity [0,1,2] reversed (n=3) => [2,1,0].
  expect(useEditor.getState().history.present.objects[0].shapeTrack![0].correspondence).toEqual([
    2, 1, 0,
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx`
Expected: FAIL — shift/reverse buttons don't exist.

- [ ] **Step 3: Add the nudge buttons**

Replace the `kfCorr` row from Task B1.2 with the fuller control set. The current map (for nudging) seeds from identity when absent:

```tsx
          {kfCorr && (() => {
            const m = kfCorr.from.nodes.length;
            const n = kfCorr.to.nodes.length;
            const cur = kfCorr.map ?? identityCorrespondence(m, n);
            return (
              <div className={styles.row}>
                <span>correspondence</span>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedShapeKeyframeCorrespondence(
                      suggestCorrespondence(kfCorr!.from, kfCorr!.to),
                    )
                  }
                >
                  Suggest correspondence
                </button>
                {kfCorr.to.closed && (
                  <>
                    <button
                      type="button"
                      aria-label="Shift correspondence backward"
                      onClick={() => setSelectedShapeKeyframeCorrespondence(shiftCorrespondence(cur, n, -1))}
                    >
                      ◀
                    </button>
                    <button
                      type="button"
                      aria-label="Shift correspondence forward"
                      onClick={() => setSelectedShapeKeyframeCorrespondence(shiftCorrespondence(cur, n, 1))}
                    >
                      ▶
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedShapeKeyframeCorrespondence(reverseCorrespondence(cur, n))}
                >
                  Reverse correspondence winding
                </button>
                <span>{correspondenceSummary(kfCorr.map, kfCorr.from, kfCorr.to)}</span>
              </div>
            );
          })()}
```

Note: `kfCorr.to.closed` gates the shift controls (closed paths only). The `reverse` button uses its visible text as its accessible name (`Reverse correspondence winding`); shift buttons use `aria-label` since their text is a glyph.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Full UI gate**

Run: `pnpm vitest run src/ui && pnpm typecheck && pnpm lint`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/Inspector/Inspector.tsx src/ui/components/Inspector/Inspector.test.tsx
git commit -m "feat(inspector): correspondence shift/reverse nudges (shift closed-only)"
```

---

## Plan B1 — Self-review checklist

- One undo step per gesture? ✓ each button = one `commit`; B1.1 asserts `past.length + 1`.
- Corresponded + non-last gating? ✓ `kfCorr` set only then; B1.2 hides tests.
- Closed-only shift? ✓ `kfCorr.to.closed` gate; B1.3 open-path test.
- Reuses engine helpers, no new engine code? ✓ summary uses `suggestCorrespondence`.
- Accessible names stable for tests? ✓ explicit text / `aria-label`.
