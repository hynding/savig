# Savig M4 Slice 45c — Layers-tree group rows

**Date:** 2026-06-22
**Status:** Approved (autonomous slice cycle — finishes the visible gap from grouping phase 2)
**Depends on:** 45a/45b (group containers). Spec context: `2026-06-22-savig-m4-slice45-group-container-design.md` §6.

## 1. Goal

Show the group hierarchy in the Layers panel. Today the panel lists every object flat by
zOrder, so a group container and its children appear intermingled with no structure. 45c
renders a TREE: top-level rows + group rows (with a disclosure toggle) + the group's
children nested/indented beneath it, with expand/collapse. A group's eye toggle hides the
whole group (cascading visibility).

## 2. Behavior

- **Tree:** top-level objects (no `parentId`), front-first by zOrder. A group row shows a
  disclosure toggle (▾ expanded / ▸ collapsed); when expanded, its children render indented
  (depth 1) directly below it, front-first by zOrder. Children never appear at top level.
- **Expand/collapse:** per-group local UI state (default EXPANDED). Toggling is purely
  visual (no store/persistence change).
- **Selection:** clicking any row (group or child) routes through `selectObjectOrGroup` →
  selects the GROUP (canvas-consistent; granular child selection is the deferred
  enter-group work). Shift/Cmd → `toggleObjectOrGroup`.
- **Rename / per-row controls:** unchanged — name (double-click to rename), and the eye /
  lock buttons act on that row's own object (a child's eye/lock is per-child).
- **Group visibility cascade:** a group row has an eye toggle that sets the group's
  `hidden`; a child is treated as hidden by render/export when EITHER it or its parent group
  is hidden. (A group has no `lock` button this slice — group lock cascade is deferred.)

## 3. Engine — effective hidden

A small pure helper drives the cascade at the two sites that gate whether a node/element
EXISTS (the same sites that already skip a plain-hidden object):
`isRenderHidden(obj, objectsById): boolean = obj.hidden || (parent group is hidden)`.
- `src/services/export/renderDocument.ts`: a child of a hidden group emits no element.
- `src/ui/components/Stage/Stage.tsx` `ordered` memo: a child of a hidden group gets no node.

`computeFrame` is intentionally UNCHANGED — it already does not skip plain-hidden objects
(it produces a FrameItem that simply has no node to apply to, in both the editor and the
exported runtime). Since the two render sites omit the node/element, the child is absent in
preview AND export — parity holds. (The existing computeFrame-vs-sampleProject parity test
is unaffected.)

## 4. Scope (YAGNI)

**In:** Layers tree (top-level + group rows + nested children + expand/collapse + rename);
clicking a row selects the group; group eye toggle with a render/export visibility cascade.

**Out (deferred → 45c-cont / 45d):** DRAG-REPARENT (drag an object into/out of a group —
needs an inverse-bake to preserve world position); group LOCK cascade; granular
child-selection + canvas editing (double-click-to-enter-a-member); reordering across levels;
nested groups in the tree (one level today). The EXISTING drag-reorder stays as-is (zOrder);
cross-level drags just change zOrder (no reparent) — acceptable, documented.

**Editor + a 3-site visibility cascade only:** no persistence/data-model change.

## 5. Implementation surface

- `src/engine/groupTransform.ts` (or a small sibling): `isRenderHidden(obj, objectsById)`.
- `src/runtime/frame.ts`, `src/services/export/renderDocument.ts`, `src/ui/components/Stage/Stage.tsx`:
  use it at the hidden-skip sites.
- `src/ui/components/LayersPanel/LayersPanel.tsx`: build a flat render list of
  `{ obj, depth }` (top-level, then each expanded group's children); render with indentation;
  a disclosure toggle on group rows (`data-testid="disclosure-<id>"`); expand state in local
  `useState<Set<string>>`.
- `src/ui/components/LayersPanel/LayersPanel.module.css`: an indent class for depth-1 rows;
  a disclosure-button class.

## 6. Testing

- **Engine (`groupTransform.test.ts`):** `isRenderHidden` true for a visible child of a
  hidden group; false otherwise.
- **`frame.test.ts` / `renderDocument.test.ts`:** a child of a hidden group produces no
  FrameItem / no export element (cascade), while a child of a visible group renders.
- **`LayersPanel.test.tsx`:** a group renders with its children nested (children NOT at top
  level); collapsing the group hides its child rows; clicking a child row selects the group;
  the group eye toggles the group's `hidden`.
- **e2e (`layers-tree.spec.ts`):** group two rects → the Layers panel shows a group row with
  the two children nested under it; the disclosure toggle collapses/expands them; toggling
  the group eye hides both children on the Stage.

## 7. Risks

- **Parity:** the visibility cascade MUST be applied identically by `computeFrame` and
  `renderDocument` (guarded by the existing preview==export parity test + new cascade tests).
- **Front-first ordering within a group:** children sort by their own zOrder; this is a
  display concern only (render order/compositing already follows the flat zOrder + the group
  transform composition from 45a — unchanged).
- **No data change:** expand/collapse is ephemeral UI state; nothing new persists.
