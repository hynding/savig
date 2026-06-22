# Savig M4 Slice 36 — Multi-select foundation

**Date:** 2026-06-22
**Status:** Approved (autonomous slice cycle — first M4 slice)
**Depends on:** M1 selection/Stage/Layers/Inspector, Slice 19 lock, Slice 33 (objectAABB)

## 0. Milestone context

**M3 (path morphing & advanced tweens) is COMPLETE** — every M3 feature shipped during
M2 (path morphing S3, arc-length/correspondence/per-node-easing F2–F4, motion paths S5,
custom-bezier easing UI F1). **M4 (grouping, layers & nested symbols/clips)** is the
active milestone: layers panel, locking, **visibility**, and reorder already ship; this
slice adds **multi-select**, the keystone that unblocks grouping and boolean ops.

## 1. Goal

Select multiple objects (Shift/Cmd-click on the Stage and in the Layers panel) and act
on them in bulk (delete, duplicate). The selection drives a multi-object highlight on the
Stage and a multi-state Inspector. Per-object editing and on-canvas transform handles
remain single-object (the "primary"); moving/transforming a whole selection is a
follow-up.

## 2. Selection model

Add `selectedObjectIds: string[]` (transient, reset on newProject). **Invariant:**
`selectedObjectId` (the existing field, unchanged) is the **primary/anchor** =
`selectedObjectIds.at(-1) ?? null`. Every current single-read site keeps reading the
primary; only multi-aware features read the array.

- `selectObject(id|null)` → `selectedObjectIds = id ? [id] : []`, primary = id, clear
  keyframe/node selections (existing behavior, now also sets the array).
- `toggleObjectSelection(id)` → add/remove `id`; primary = new last (or null); clear
  keyframe/node selections.
- `selectObjects(ids)` → set the array; primary = last (used by bulk-duplicate to select
  all clones; reused by a future marquee).
- `clearStaleSelection` (post undo/redo) prunes deleted ids from the array and resyncs
  the primary.

## 3. Interaction

- **Stage object pointer-down:** Shift OR Cmd/Ctrl held → `toggleObjectSelection(id)` and
  DO NOT start a move-drag (selection-building gesture). Plain click → `selectObject(id)`
  + begin the existing single-object move-drag. (So a drag always collapses to / operates
  on one object; snapping is unaffected.) Locked objects stay inert (bubble to deselect).
- **Layers row click:** Shift/Cmd → toggle; plain → single. All selected rows highlighted.
- **Bulk delete** (`deleteSelectedObject`, called by keyboard Delete + Inspector): remove
  every selected non-locked object in one commit, then clear the selection.
- **Bulk duplicate** (`duplicateSelected`, Cmd+D + Inspector): duplicate every selected
  non-locked object in one commit; select the (non-locked) clones.
- **Stage highlight:** draw a thin selection outline rect (via `objectAABB`, slice 33) for
  every selected object — so a multi-selection is visible even though handles show only
  for the single/primary case.
- **Inspector:** `selectedObjectIds.length > 1` → a compact multi-state ("N objects
  selected" + Delete / Duplicate buttons); exactly 1 → the existing full Inspector; 0 →
  "No object selected".

## 4. Scope (YAGNI)

**In:** the selection model; Shift/Cmd-click (Stage + Layers); bulk delete + duplicate;
Stage multi-highlight; Inspector multi-state.

**Out (deferred, tracked → next M4 slices):** marquee / rubber-band selection;
multi-object MOVE (drag + arrow-nudge move only the primary this slice); multi-object
transform (group resize/rotate/scale); multi-object copy/paste (clipboard stays single);
**grouping** (parent/child); **boolean ops**; nested symbols/clips.

**Editor-only:** no engine/export/runtime/persistence/migration change (v4). Selection is
transient UI state.

## 5. Implementation surface

- `src/ui/store/store.ts`: `selectedObjectIds` (TRANSIENT default `[]`); `selectObject`
  also sets the array; new `toggleObjectSelection`/`selectObjects`; `clearStaleSelection`
  prunes the array; `deleteSelectedObject` + `duplicateSelected` iterate the array.
- `src/ui/components/Stage/Stage.tsx`: `onObjectPointerDown` Shift/Cmd branch → toggle (no
  drag); a selection-outline overlay (`objectAABB` per selected id) in the pan/zoom group.
- `src/ui/components/LayersPanel/LayersPanel.tsx`: Shift/Cmd row click → toggle; highlight
  all selected rows (`selectedObjectIds.includes`).
- `src/ui/components/Inspector/Inspector.tsx`: multi-state branch.
- (No change to `useKeyboard` — Delete/Cmd+D already call the now-bulk actions.)

## 6. Testing

**Store (`store.test.ts`):**
- `toggleObjectSelection` adds then removes; primary tracks the last; `selectObject`
  collapses to one + sets the array.
- bulk `deleteSelectedObject` removes ALL selected (skips locked) and clears selection.
- bulk `duplicateSelected` clones ALL selected and selects the clones (count doubles).
- undo of a multi-delete restores; `clearStaleSelection` prunes a stale id from the array.
- single-object behavior preserved (existing select/delete/duplicate tests stay green).

**Stage (`Stage.test.tsx`):** Shift-click a second object adds it (selectedObjectIds length
2, no move-drag started); a selection-outline element renders per selected object; plain
click collapses to one.

**Layers (`LayersPanel.test.tsx`):** Shift-click toggles membership; multiple rows show
`data-selected`.

**Inspector (`Inspector.test.tsx`):** 2 selected → "2 … selected" + Delete/Duplicate; the
Duplicate button calls `duplicateSelected`.

**e2e (`multi-select.spec.ts`):** draw two rects; Shift-click the first to add it (both
selected); press Delete → 0 objects. (And a duplicate path → 4.)

## 7. Risks

- **Primary invariant drift:** every selection mutation must set BOTH `selectedObjectIds`
  and `selectedObjectId` consistently (primary = last). Centralize in the 3 actions.
- **Locked objects:** excluded from bulk delete/duplicate (as single-object today); a
  selection may include a locked object (e.g. via Layers) — bulk ops skip it.
- **Stale selection after undo:** prune the array, not just the primary.
