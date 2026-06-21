# Savig — M2 Feature 4: Per-Node Easing (Design)

**Date:** 2026-06-20
**Status:** Approved design — ready for implementation planning
**Author:** Steve Hynding (with Claude)
**Roadmap:** [M2 Morph & Easing Roadmap §3.4](./2026-06-20-savig-m2-morph-easing-roadmap-design.md) — feature 4 of 4 (final)
**Builds on:** Feature 1's `EasingEditor`, and the reconcile seam from Features 2/3.

## Summary

Give each morphing node its own easing into the next keyframe — a blob whose lobes
arrive on different beats — instead of one easing for the whole shape. The feature
reduces to **one optional field** (`nodeEasings?: Easing[]`) on the from-keyframe plus a
**per-pair `t`** in the existing `samplePath` interpolation loop. Default-absent reproduces
today's single-easing morph exactly, so persistence is a **no-op version bump** and every
existing parity/e2e test passes unchanged.

Per-node easing is **corresponded-only** (index-pad *and* explicit correspondence map);
it is ignored under `resampled`, which has no stable node identity (roadmap §1.3). The
authoring UI reuses Feature 1's `EasingEditor`, scoped to the selected node.

### Stack & standards (unchanged from M1/M2)

pnpm · Vite · React 18 + TS (strict) · Zustand · Vitest + RTL · Playwright · CSS
Modules + design tokens. Client-only. TDD throughout. The engine layer stays **pure
TypeScript with zero React/DOM dependencies**; the render core lifts verbatim into the
export runtime. Preview == export parity is preserved: the editor Stage and the export
runtime interpolate via the **same** pure `samplePath` and serialize via the **same**
`pathToD`.

---

## 1. Where per-node easing sits

The keyframe's `easing` (Feature 1) governs the **whole** transition into the next
keyframe. Per-node easing **overrides** it for individual nodes; any node without an
override uses the keyframe's `easing`. So the two compose cleanly — per-node is a sparse
set of overrides on top of the keyframe default, never a competing global control.

| Morph mode | Per-node easing |
|---|---|
| `corresponded` index-pad (default) | applied to from-node `i` (padded/degenerate pairs use the keyframe default) |
| `corresponded` + explicit map | follows each node through the map; grow-from-point spurs use the keyframe default |
| `resampled` | **not offered** — resampling destroys node identity; `nodeEasings` is ignored (persists but inert) |

---

## 2. Data model

One new **optional** field on the from-keyframe, mirroring `easing`/`morph`/`correspondence`:

```ts
interface ShapeKeyframe {
  time: number;
  path: PathData;
  easing: Easing;            // (exists) the keyframe's default transition easing
  morph?: MorphMode;         // feature 2
  correspondence?: number[]; // feature 3
  nodeEasings?: Easing[];    // feature 4 — sparse, aligned 1:1 with path.nodes
}
```

Semantics of `nodeEasings`:

- `nodeEasings[i]` is the easing for **from-node `i`** into the next keyframe. The array is
  **sparse**: only customized indices are set; holes (`undefined`) — and `null`, which is
  how a sparse-array hole serializes to JSON — fall back to the keyframe's `easing`.
- Aligned **1:1 with `path.nodes`**; the two count-changing node edits keep them aligned (§5).
- **Default-absent ⇒ every node uses `a.easing` ⇒ byte-identical to today.** No-op
  migration; old projects load unchanged.
- Honored **only in corresponded mode**; ignored under `resampled`.

---

## 3. Engine

### 3.1 `reconcile` reports node provenance

Because the reconcile seam reorders and expands nodes (index-pad padding, correspondence
walk-B, resample), the easing of "node `i`" must follow the node through reconciliation.
`Reconciled` gains an `aIndex` array — the **source from-node index for each output pair**,
or `-1` when the output pair has no source node:

```ts
interface Reconciled {
  an: PathNode[];
  bn: PathNode[];
  aIndex: number[]; // length === an.length; source A-node per pair, -1 if none
}
```

- **index-pad:** `aIndex[i] = i` for `i < m` (real from-nodes); `-1` for the padded tail.
- **correspondence-map (walk-B):** the source `i` for each emitted pair; `-1` for
  grow-from-point spurs. A many-to-one **merge** emits one pair per source `i`, each
  carrying its own `aIndex` (so merged nodes can ease independently onto the shared point).
- **resampled:** all `-1` (no node identity).

`reconcile` stays **easing-agnostic** — it reports structure (`aIndex`); `samplePath` maps
that to easing. (This is a deliberate, cleaner split than the roadmap's tentative
`pairEasings`: easing knowledge lives in one place, `samplePath`.)

### 3.2 `samplePath` applies a per-pair `t`

The single-`t` loop becomes per-pair. Today (`path.ts:104-108`):

```ts
const t = applyEasing(a.easing, rawProgress);
const { an, bn } = reconcile(a.path, b.path, a.morph ?? 'corresponded', a.correspondence);
const nodes: PathNode[] = [];
for (let i = 0; i < an.length; i++) nodes.push(lerpNode(an[i], bn[i], t));
```

Revised:

```ts
const { an, bn, aIndex } = reconcile(a.path, b.path, a.morph ?? 'corresponded', a.correspondence);
const nodes: PathNode[] = [];
for (let k = 0; k < an.length; k++) {
  const e = (aIndex[k] >= 0 ? a.nodeEasings?.[aIndex[k]] : undefined) ?? a.easing;
  nodes.push(lerpNode(an[k], bn[k], applyEasing(e, rawProgress)));
}
```

- A `-1` pair (spur / padded / resampled) or a hole/`null` entry uses `a.easing`. With no
  `nodeEasings`, every `e` collapses to `a.easing` → the current single `t` → **byte-identical**.
- `closed` still held from A; `lerpNode` unchanged.

### 3.3 What this feature does **not** touch in the engine

- `lerpNode`, `pathToD`, `align`, `resample`, `suggest` — unchanged.
- No new morph math; `reconcile` gains one bookkeeping array.
- Runtime bundle regenerated (`pnpm build:runtime`); a parity assertion covers a
  per-node-eased morph at several `t`.

---

## 4. UI

### 4.1 Store action

`setSelectedNodeEasing(easing: Easing | undefined)` — writes `nodeEasings[selectedNodeIndex]`
on the **selected shape keyframe**; `undefined` clears that entry (→ hole → keyframe
default). One undo step. No-op unless both a shape keyframe is selected and
`selectedNodeIndex != null`. (The node indices align because you author a keyframe's nodes
while editing that keyframe — the same model as existing shape-keyframe node editing.)

### 4.2 Inspector "Node easing" section

Shown when a node is selected (`selectedNodeIndex != null`) **and** a shape keyframe is
selected on that object **and** the transition is `corresponded` (hidden under `resampled`,
where it would be inert — consistent with how the Feature 3 correspondence controls hide).

- Header: `node N easing` (N = `selectedNodeIndex`).
- A short line clarifying it **overrides the keyframe easing for this node**.
- Reuses Feature 1's `EasingEditor` (`value = nodeEasings[N] ?? keyframe.easing`;
  `onChange` → `setSelectedNodeEasing`).
- A **reset-to-default** control → `setSelectedNodeEasing(undefined)` (back to the hole).
- For the **last keyframe** (no outbound transition) the editor is inert — reuse
  `EasingEditor`'s existing `inert` hint, as the keyframe-easing editor does.

The Feature 1 "Keyframe" easing editor remains visible above it; ordering makes the
default→override relationship legible (keyframe easing first, then the node override).

### 4.3 Stage discoverability marker

Nodes carrying a custom easing (`nodeEasings[i]` set) get a distinct marker in the
node-overlay (e.g. an accent ring around the node rect) so per-node easing is visible at a
glance rather than requiring a click per node. Small addition to the existing
`node-overlay` render in `Stage.tsx`.

---

## 5. Node-edit maintenance (keeping `nodeEasings` aligned)

`nodeEasings` is a parallel sparse array, so it must track structural node edits. Verified:
only **two** edits change node count — all others (`move`, `corner↔smooth` via
`toggleSmooth`, `join`/`break` handles) operate in place and leave indices stable, so they
need no maintenance.

A pure helper does the array surgery, living beside the existing structural node helpers
in `src/ui/components/Stage/pathEdit.ts` (`insertNodeAt`/`deleteNodeAt`):

```ts
// src/ui/components/Stage/pathEdit.ts — pure, unit-tested
function spliceNodeEasings(easings: Easing[] | undefined, index: number, op: 'insert' | 'delete'): Easing[] | undefined;
```

- **delete-node** (`deleteSelectedNode`): splice out `index`; commit path + realigned
  `nodeEasings` together (one undo step).
- **insert-node**: today inline in `Stage.tsx` (`setPathData(insertNodeAt(...))` +
  `selectNode(+1)`). **Promote to a store action** `insertNode(segmentIndex, t)` that
  inserts the node, splices a **hole** into `nodeEasings` at the new index, selects the new
  node, and commits once — mirroring `deleteSelectedNode` and making the realignment
  unit-testable. Behavior is unchanged for paths without `nodeEasings`.

Same-count edits flow through `setPathData` unchanged (no `nodeEasings` touch).

---

## 6. Testing (TDD: engine → parity → RTL → e2e)

**Engine (`reconcile`, `samplePath`):**
- `reconcile` reports `aIndex`: index-pad (`i`, then `-1` for padding); correspondence-map
  (source `i`, `-1` for spurs, distinct per merged pair); resampled (all `-1`).
- `samplePath` with no `nodeEasings` is byte-identical to today (regression).
- A two-node path where node 0 is `easeIn` and node 1 `linear` reaches different positions
  at the same `t` (the per-node effect), and both endpoints stay exact.
- A hole / `null` entry falls back to the keyframe easing; a `-1` pair uses the keyframe easing.
- `spliceNodeEasings`: insert adds a hole at index (shifting later entries); delete removes
  it; immutability.

**Parity:** a per-node-eased morph yields identical `d` Stage == export == runtime at several
`t` (regenerate the runtime bundle).

**RTL:** Node-easing section appears only for a node selected on a corresponded shape
keyframe; editing writes `nodeEasings[N]`; reset clears it; hidden under `resampled`;
one undo step; the Stage marker appears for custom-easing nodes. `insertNode`/`deleteNode`
keep `nodeEasings` aligned (a customized node keeps its easing after an unrelated insert/delete).

**e2e:** two-node morph where one node eases in and the other is linear → exported bundle
animates the two nodes on different beats (their `d` divergence differs from a single-easing morph).

---

## 7. Plan decomposition

- **Plan A — engine** (pure, TDD): `nodeEasings?` field; `reconcile` `aIndex` (all three
  branches); `samplePath` per-pair `t`; `spliceNodeEasings` pure helper; runtime bundle
  regenerated; parity assertions; **no migration** (no-op bump).
- **Plan B — UI** (RTL + e2e): `setSelectedNodeEasing` store action; Inspector Node-easing
  section (corresponded-only, reset, inert-on-last); promote node-insert to `insertNode`
  action + wire `spliceNodeEasings` into `insertNode`/`deleteSelectedNode`; Stage
  custom-easing marker; per-node e2e.

Each prefix is shippable: A alone makes `nodeEasings` honored (authorable from tests/console);
A+B delivers the full authoring experience.

---

## 8. Cross-cutting invariants (unchanged)

- **Preview == export parity** through the shared pure `samplePath` → `pathToD`; new parity
  assertion at several `t`.
- **Optional field only** → persistence is a no-op version bump; default-absent reproduces
  today's single-easing morph exactly; `null` holes fall back like `undefined`.
- **One undo step per user gesture** (set node easing, reset, insert/delete node).
- **Engine stays pure** (no React/DOM); runtime bundle regenerated when the engine changes.
- **TDD**: engine oracle tests first, then runtime/parity, then RTL, then e2e.

---

## 9. Fresh-perspective self-review

- **Redundant with keyframe easing?** No — per-node is a sparse override layer; absent ⇒
  keyframe default. §1 makes the composition explicit and the UI labels it. ✓
- **Does the field risk the parity guarantee?** Only if it changed default output. Absent /
  all-hole `nodeEasings` collapse every per-pair `t` to `a.easing` = today; guarded by the
  Slice 2/3 + Feature 2/3 parity/e2e. ✓
- **Why `aIndex` not `pairEasings`?** Keeps `reconcile` easing-agnostic; easing lookup lives
  only in `samplePath`. Cleaner separation than the roadmap sketch. ✓
- **Is the alignment burden bounded?** Verified only `insert`/`delete` change node count;
  all other node edits are in-place. Two call sites, one pure helper. ✓
- **Resampled interaction?** `nodeEasings` persists but is inert under `resampled` (all
  `aIndex = -1`); the UI hides the section there, so it can't mislead. ✓
- **Could stopping early strand value?** No — A makes the engine honor `nodeEasings`; A+B
  adds authoring. Each prefix is shippable. ✓
- **Biggest residual risk.** The node-insert refactor (inline `Stage.tsx` → `insertNode`
  action) touches working Slice 2 code; behavior-preserving for paths without `nodeEasings`
  and covered by existing + new tests. Flagged for Plan B. ✓
