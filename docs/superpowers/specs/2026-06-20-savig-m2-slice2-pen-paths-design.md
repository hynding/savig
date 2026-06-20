# Savig — M2 Slice 2: Pen/Bezier Paths + Node Editing (Design)

## Summary

The second slice of **Milestone 2 — Vector drawing tools**. It adds a **pen tool**
for authoring bezier paths and a **dedicated node tool** for editing them, building
directly on Slice 1's editable-vector architecture (uuid `VectorAsset`, the
object's transform/opacity tracks, fractional-anchor resolution, and the shared
pure `renderShapeToSvg` parity oracle).

Path **shape is static this slice** — nodes are authored and edited, but node
positions do **not** keyframe. Paths still animate via the existing
transform/opacity object tracks. This deliberately defers path *morphing*
(matched-node-count interpolation) to its own later slice, keeping Slice 2 focused
on authoring + editing on a proven foundation.

A consequence worth stating up front: because the path's `d` is static, the export
runtime needs **no per-frame path update** at all (unlike rect/ellipse, whose
scalar geometry animates). The new engine weight is one pure serializer
(`pathToD`); the bulk of the work is the UI authoring/editing layer.

### Stack & standards (unchanged from M1/Slice 1)

pnpm · Vite · React 18 + TS (strict) · Zustand (UI state) · Vitest + RTL ·
Playwright (e2e) · CSS Modules + design tokens. Client-only, no backend. TDD
throughout. The engine layer stays **pure TypeScript with zero React/DOM
dependencies** so the render core lifts verbatim into the export runtime.

---

## Scope

### In scope (this slice)

- **Pen tool**: click = corner node; click-drag = smooth node (mirrored control
  handles); click the first anchor = close the path; Enter / double-click = finish
  as an open path; Escape = cancel the in-progress draft.
- **Dedicated node tool** with the **full editing toolkit**:
  - move anchors and their bezier control handles,
  - insert a node on a segment, delete a selected node,
  - convert corner ↔ smooth,
  - break / join handles (independent vs mirrored control handles).
- Paths are **fully animatable in transform/opacity** (the existing object
  tracks). **Path shape is static** (node positions do not keyframe).
- `VectorStyle` gains **`strokeLinecap` and `strokeLinejoin`** (apply to all vector
  shapes; static this slice).
- **Preview == export parity** maintained for paths (static markup + animated
  transform/opacity).
- Backward-compatible **persistence migration** (old projects load unchanged).

### Out of scope (later M2 slices)

Path-shape **morphing** (keyframing node positions) · freehand brush · polygon /
line / star · gradients · fill/stroke **color** animation · `fill-rule`
(evenodd/nonzero) · boolean ops · multi-node marquee select / copy-paste · node or
grid snapping · grouping/layers · reuse/instancing UI for drawn assets · on-canvas
rotate handle.

> These are recorded so they are tracked; **path-shape morphing is the natural
> next slice** and reuses the `PathData` model defined here. Freehand brush, more
> primitives, and boolean ops all also reduce to or operate on `PathData`.

---

## 1. Architecture (fits the existing three layers)

No new layers. The work slots into the M1/Slice-1 structure:

```
UI layer        Toolbar (pen/node tools) · Stage (pen authoring + node overlay) ·
                Inspector (style incl. cap/join + node-edit buttons) ·
                pure helpers: pathEdit.ts (node ops) · pathHitTest.ts
Engine layer    VectorShapeType 'path' · PathData on VectorAsset · pathToD +
                pathBounds (pure) · renderShapeToSvg path branch · resolveAnchor
                path case · migration v2->v3
Services layer  Export inline <path> branch · runtime (no per-frame path update) ·
                persistence (already serialization-agnostic)
```

**Key principle preserved:** `pathToD` is pure and dependency-free, called by
**both** the Stage and the export path (`renderShapeToSvg`), so the editor and the
exported bundle emit byte-identical path markup — preview cannot drift from export.

---

## 2. Data model

```ts
type VectorShapeType = 'rect' | 'ellipse' | 'path';   // + 'path'

interface PathPoint { x: number; y: number; }

interface PathNode {
  anchor: PathPoint;
  /** Incoming control handle, OFFSET relative to anchor. Absent = corner (no handle). */
  in?: PathPoint;
  /** Outgoing control handle, offset relative to anchor. Absent = corner. */
  out?: PathPoint;
}

interface PathData {
  nodes: PathNode[];
  closed: boolean;
}

interface VectorAsset {
  // ...existing: id (uuid), kind:'vector', name, shapeType, style
  path?: PathData;   // present iff shapeType === 'path'
}

interface VectorStyle {
  fill: string;          // existing — CSS color or 'none'
  stroke: string;        // existing — CSS color or 'none'
  strokeWidth: number;   // existing
  strokeLinecap?: 'butt' | 'round' | 'square';     // new, optional, render default 'butt'
  strokeLinejoin?: 'miter' | 'round' | 'bevel';    // new, optional, render default 'miter'
}
```

### Model decisions

- **Smooth vs corner is derived, not flagged.** A node is *smooth* when `in` and
  `out` are mirrored (`in == -out`); *break* lets them diverge; *join* re-mirrors;
  *corner* = no handles. One less field to keep consistent. (An optional explicit
  hint is unnecessary; the convert/break/join ops set the handle geometry directly.)
- **Path data lives on the `VectorAsset`** (which already owns `shapeType` +
  `style` and is undoable document state). Node editing mutates the asset, exactly
  like `setVectorStyle` already does. This is the correct shared-symbol semantics
  if instancing ever lands (deferred).
- **Path nodes are local-space.** At pen-commit, `base.x/base.y` is set to the
  drawn path's **bbox top-left**, and nodes are stored **relative to that** (bbox at
  origin) — matching the rect convention (local shape starts at origin, placement
  via the object transform). We do **not** renormalize on every node edit (that
  would jitter `base.x/y`); instead `pathBounds`/`resolveAnchor` recompute the
  bbox min so post-edit drift stays correct.
- **Path shape does not keyframe.** `PathData` carries no tracks; it is not part of
  the scalar `ResolvedGeometry`/track system. Transform/opacity animate via the
  existing object tracks.
- **New stroke style fields are optional with render-time defaults**, so the
  persistence migration is a no-op version bump (no rewrite of existing assets).
- **Path default style differs from rect/ellipse.** `DEFAULT_VECTOR_STYLE`
  (`fill:'#cccccc', stroke:'none', strokeWidth:0`) would render an open path
  invisible. `addVectorPath` sets a path default of **`fill:'none',
  stroke:'#000000', strokeWidth:2`**.

---

## 3. Engine & parity

### 3.1 `pathToD` (the shared, parity-critical serializer)

```ts
pathToD(path: PathData): string
```

Pure, dependency-free. Walks `nodes` emitting:
- `M` to the first anchor;
- for each segment, `C c1 c2 anchor` (cubic bezier) using the previous node's
  `out` handle and the current node's `in` handle (each = anchor + offset); when
  both handles are absent the segment degenerates to a straight `L`;
- when `closed`, the final segment connects the last node back to the first and a
  `Z` is appended.

All numbers go through the existing `fmt()` so the editor and export produce
byte-identical output.

### 3.2 `pathBounds`

```ts
pathBounds(path: PathData): { x: number; y: number; width: number; height: number }
```

Anchor-point extents (not curve-tight bounds — sufficient for the pivot and the
selection bbox this slice; curve-tight bounds are a cheap later refinement). Used
by `resolveAnchor` and selection feedback.

### 3.3 `renderShapeToSvg` extension

```ts
renderShapeToSvg(shapeType, geometry, style, path?): string
```

Adds a `path` branch: `<path d="{pathToD(path)}" {style-attrs}/>`. `geometry` is
ignored for paths. `styleToSvgAttrs` emits `stroke-linecap`/`stroke-linejoin` when
present (defaulting at render). Reuses the existing `escapeAttr`. A path object
with a missing/empty `path` renders nothing (defensive, like a missing asset).

### 3.4 `resolveAnchor` — path case + close the Slice-1 footgun

`resolveAnchor` gains a `path` branch resolving the fractional anchor against
`pathBounds` (including the bbox min offset):

```
absAnchorX = bbox.x + anchorX * bbox.width
absAnchorY = bbox.y + anchorY * bbox.height
```

Because there are now three shape types whose anchors resolve differently, the
Slice-1 deferred follow-up — **make `resolveAnchor`'s `shapeType` required** — is
done here to remove the silent-mis-pivot footgun. All call sites
(`renderDocument`, `frame.computeFrame`, `Stage`) already have the asset in hand
and pass `shapeType`.

### 3.5 Sampling & runtime (no per-frame path work)

`sampleObject` produces **no `geometry`** for path objects (paths have no scalar
geometry tracks), so `computeFrame` emits no `item.geometry` and
`applyFrameToNodes` performs **no inner-shape update** for paths. The path `<path
d>` is emitted once (preview and export) and only the wrapping `<g transform>`
animates. This is strictly less runtime machinery than Slice 1's `applyGeometry`.

---

## 4. Rendering & export

### Stage (preview)

The vector-rendering branch (currently a `rect`/`ellipse` ternary rendering real
React elements — no `dangerouslySetInnerHTML`, so attribute values are escaped)
gains a `path` case: `<path d={pathToD(asset.path)} fill={…} stroke={…}
strokeWidth={…} strokeLinecap={…} strokeLinejoin={…}/>`. `d` is numeric-derived
and React-escaped, so it is XSS-safe.

### Export (HTML5 bundle)

`renderDocument` emits an inline `<g …><path d="…"/></g>` for path objects (same
inline-vector approach as rect/ellipse, different element), via
`renderShapeToSvg(asset.shapeType, state.geometry ?? {}, asset.style,
asset.path)`. `<defs>` continues to hold only imported SVG assets. Object
iteration is already `zOrder`-ordered, so drawn paths interleave correctly with
imported SVGs and other shapes.

### Parity

- Stage and export both serialize via `pathToD`, so the path `d` is identical by
  construction. A test asserts the Stage-rendered `d` equals the exported `d`.
- Transform/opacity parity reuses the existing runtime↔engine harness.
- The per-frame geometry parity (rect/ellipse) does not apply to paths (no
  per-frame geometry), which the parity test documents explicitly.

---

## 5. UI layer

### 5.1 Tool palette

`ToolPalette` grows from `select · rect · ellipse` to
**`select · pen · node · rect · ellipse`**. Active tool stays ephemeral UI state
(not persisted, not undoable). Shortcuts: `P` (pen), `N` (node), plus existing
`V`/`R`/`E`. `Escape` cancels an in-progress pen draft first, then returns to
select.

### 5.2 Pen authoring

A multi-click interaction. The in-progress draft (committed nodes so far + the
live rubber-band segment following the cursor) is **Stage-local ephemeral state**
(mirroring Slice 1's drag-preview). Behavior:

- **Click** places a corner node; **click-drag** places a smooth node with mirrored
  `in`/`out` handles sized by the drag.
- A **snap-to-close affordance** highlights the first anchor when the cursor is
  near it (`nearFirstAnchor`); clicking it **closes** the path.
- **Enter** or **double-click** finishes as an **open** path; **Escape** cancels
  the whole draft (no shape created).
- On finish (closed or open, ≥ 2 nodes), a single `addVectorPath(pathData)` store
  action commits **one undo step**: create the `VectorAsset` (`shapeType:'path'`,
  path default style, `path` with `base`=bbox-min and nodes relative), create the
  `SceneObject` (`anchorMode:'fraction'`, anchor 0.5/0.5), select it, and switch to
  the **node tool**. A draft below the minimum (< 2 nodes) creates nothing.

All pointer math reuses the existing `clientToLocal` (screen → stage-local through
the content group's CTM; zoom/pan-aware).

### 5.3 Node tool & editing

When the node tool is active and a path object is selected, the Stage renders a
**node overlay** inside the object's transformed group: anchors, control handles,
and handle lines. The currently selected node is transient UI state
(`selectedNodeIndex`).

Editing operations are **pure functions** in `pathEdit.ts` (DOM-free, unit-tested
like `applyHandleResize`), each producing a new `PathData`; the store commits via
`setPathData`:

- **Move anchor / handle**: drag → imperative preview, single commit on
  pointer-up (reuses Slice 1's drag-coalescing). Moving a smooth node's handle
  mirrors the opposite handle; a broken node's handles move independently.
- **Insert node**: click on a segment (`hitTestSegment`) inserts a node at the
  split point.
- **Delete node**: `Delete`/`Backspace` (context-gated, §5.6) or an Inspector
  button removes the selected node.
- **Convert corner ↔ smooth**: Inspector button (primary) or double-click a node.
- **Break / join handles**: Inspector button (primary) or `Alt`-drag a handle to
  break.

Hit-testing (`pathHitTest.ts`): `hitTestAnchor`, `hitTestHandle`,
`hitTestSegment`, `nearFirstAnchor` — all pure, screen→local via the same
rotation-aware inverse-transform mapping used by the resize handles.

Under the **select** tool, a path is **move-only** (drag body → `x`/`y`); the
resize-handle overlay is **not** shown for paths (only rect/ellipse). Body-drag
move already works generically.

### 5.4 Inspector

For a selected path object:

- **No scalar geometry fields** (paths have none); optionally a read-only **node
  count**. The vector block branches on `shapeType` (rect/ellipse keep their
  numeric geometry fields).
- **Style**: existing fill/stroke/strokeWidth controls **plus** `strokeLinecap`
  and `strokeLinejoin` `<select>` dropdowns (these also show for rect/ellipse).
- When the node tool is active and a node is selected: **node-edit buttons** —
  convert corner↔smooth, break/join handles, delete node.
- Existing transform/opacity/anchor fields remain.

### 5.5 Asset panel

Drawn paths are **not** surfaced in the import-oriented Asset panel (same as Slice
1's rect/ellipse exclusion).

### 5.6 Keyboard

Add `P` → pen, `N` → node. **`Delete`/`Backspace` becomes context-aware**:
when the node tool is active and a node is selected, it deletes the node;
otherwise it keeps the existing `removeSelectedKeyframe()` behavior. `Escape`
cancels an in-progress pen draft before falling through to select.

---

## 6. Persistence & migration

- Bump `meta.version` **2 → 3** in `createProject` and `migrate.ts`
  (`CURRENT_VERSION = 3`); add a `2:` no-op forward upgrader (old projects have no
  paths; new style fields are optional with render defaults).
- The `.savig` zip and IndexedDB autosave already serialize arbitrary plain-object
  assets, so `path: PathData` rides along with no format change.
- Path assets carry no binary, so they serialize inline and participate normally
  in undo/redo.

---

## 7. Error handling & edge cases

- **Pen draft < 2 nodes** on finish: nothing created; tool stays active.
- **Escape mid-draft**: draft discarded.
- **Degenerate segment** (corner-to-corner, no handles): emitted as `L`.
- **Missing/empty `path`** on a path object: renders nothing (defensive).
- **Open path with fill**: SVG implicitly closes for fill; path default is
  `fill:'none'` so this is opt-in, not surprising.
- **Rotated-path node editing**: pointer → local via the object transform's
  inverse (same mapping as resize handles), so it behaves correctly on rotated
  paths.
- **Zoom/pan**: all pointer math goes through the existing screen↔stage transform.

---

## 8. Performance

Paths add **no per-frame engine work** (static `d`; only the `<g transform>`
animates, already imperative). Pen/node interactions are pointer-driven and
imperative during drag (single commit on release), so they don't churn React or
history. This slice inherits M1's tracked perf items (the O(n) per-property
segment scan in `interpolate`, the per-call easing-solver allocation) but adds no
new per-frame cost unique to paths.

---

## 9. Testing strategy (TDD)

Engine (pure, no DOM):
- `pathToD`: open vs closed; corner (`L`) vs bezier (`C`) segments; mirrored
  handles; `fmt` formatting.
- `pathBounds`: anchor-extent bbox incl. non-zero min.
- `renderShapeToSvg` path branch: `d` output, cap/join attrs, escaping, empty-path
  defensiveness.
- `resolveAnchor` path case (bbox-min offset); `shapeType` now required.

Pure UI helpers (no DOM):
- `pathEdit.ts`: insert/delete/convert/break/join/move each produce the expected
  `PathData`, including smooth-handle mirroring and broken-handle independence.
- `pathHitTest.ts`: anchor/handle/segment hit-testing; `nearFirstAnchor`.

Runtime ↔ engine / export:
- Stage-rendered `d` === exported `d` (both via `pathToD`).
- Path object exports as inline `<g><path/></g>`; transform/opacity parity via the
  existing harness; no per-frame geometry for paths (documented).

UI (RTL):
- Pen commit = **one** undo step (asset + object); switches to node tool; selects
  new object; sub-2-node draft creates nothing; Escape cancels.
- Node move coalesces to one undo step; rotated-path node move maps correctly.
- Insert/delete/convert/break/join produce correct `PathData`.
- Inspector cap/join controls apply; node-edit buttons work; paths show no scalar
  geometry fields; paths excluded from Asset panel.
- `Delete` deletes a node in node-tool context but a keyframe otherwise.

E2E (Playwright, real Chromium):
- Draw a path with the pen, keyframe its `x`, export the bundle, and assert the
  exported animation matches the in-editor preview (extends the existing
  export-parity e2e).

Migration:
- A v2 project (no paths) loads unchanged after the bump to v3.

---

## 10. Plan decomposition (for writing-plans)

Two plans, mirroring Slice 1, each its own writing-plans → execution cycle:

- **Plan A — Engine & pipeline (no UI):** `'path'` shapeType + `PathData` on
  `VectorAsset` + style cap/join; `pathToD` + `pathBounds`; `renderShapeToSvg`
  path branch + cap/join attrs; `resolveAnchor` path case **and make `shapeType`
  required** (Slice-1 footgun); export inline-`<path>` branch; parity tests; v2→v3
  migration; engine barrel + factory (`createVectorAsset` 'path' name) updates.
- **Plan B — UI:** tool-palette pen/node + `P`/`N` shortcuts; pen authoring
  (rubber-band, smooth/corner, close/finish/cancel, snap-to-close); node tool
  overlay + full editing toolkit via pure `pathEdit.ts`/`pathHitTest.ts`; store
  actions (`addVectorPath`, `setPathData`, node-edit actions, `selectedNodeIndex`,
  path-aware default style); Stage path-render case + path exclusion from resize
  overlay; Inspector cap/join + node-edit buttons + path geometry branch;
  context-aware `Delete`; Playwright export-parity e2e. **Extract pen/node logic
  into dedicated modules** to keep `Stage.tsx` a thin coordinator.

---

## Open questions / deferred decisions

- **Curve-tight `pathBounds`** (vs anchor-extent) — deferred; anchor extents are
  fine for the pivot/selection this slice.
- **Node-edit gesture set** — Inspector buttons are the primary (testable)
  mechanism; Alt-drag-break and double-click-smooth are polish, droppable if they
  complicate the slice.
- **Path-shape morphing** — the next slice; reuses this `PathData` model with
  matched-node-count interpolation.
