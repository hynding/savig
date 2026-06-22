# Savig M4 Slice 39 — Multi-object copy / cut / paste

**Date:** 2026-06-22
**Status:** Approved (autonomous slice cycle — M4)
**Depends on:** Slice 21 (object clipboard), Slice 36 (multi-select)

## 1. Goal

Make copy / cut / paste operate on the whole multi-selection, matching the already-bulk
delete/duplicate (slice 36). Cmd+C copies all selected; Cmd+V pastes them all (offset),
selecting the clones; Cmd+X cuts them all. This completes the selection lifecycle and
removes the slice-36 `cut` "collapse-to-primary" workaround (which existed only because
copy was single while delete was bulk).

## 2. Model change

`clipboard` becomes a LIST: `{ object: SceneObject; asset?: Asset }[] | null` (was a
single `{ object, asset } | null`). Still transient and surviving `newProject`
(cross-project paste) and still mutually exclusive with `keyframeClipboard`.

- `copySelected` snapshots EVERY selected object (+ its asset), ordered by `zOrder`
  (stable paste stacking), into the list; clears `keyframeClipboard`. No selection →
  leave the clipboard untouched (no `[]`, so the keyboard's truthiness/no-op holds).
- `cut` = `copySelected()` + `deleteSelectedObject()` (both bulk) — REMOVE the
  collapse-to-primary. (Cutting a locked member copies it but `deleteSelectedObject`
  skips it — unchanged single-object semantics.)
- `paste` iterates the list, cloning each (fresh object/asset ids, `DUP_OFFSET`,
  `nextZOrder` recomputed against the growing project) into ONE commit, then selects the
  NON-locked clones via `selectObjects` (so a locked clone is added but not selected —
  Slice-19 invariant preserved; for a single non-locked clone the primary is that clone).

## 3. Scope (YAGNI)

**In:** the list-shaped clipboard; bulk copy/cut/paste; updating the existing
single-shape clipboard tests to the list shape; new multi tests.

**Out (deferred):** paste-at-cursor (still `DUP_OFFSET`); cross-object/structure-aware
paste; grouping/transform. The clipboard remains object-only (mutually exclusive with the
keyframe clipboard).

**Editor-only:** the clipboard is transient UI state — no engine/export/runtime/persistence
change (v4).

## 4. Implementation surface

- `src/ui/store/store.ts`: change the `clipboard` field type (interface + initial) to a
  list; rewrite `copySelected` (snapshot all, zOrder-sorted), `cut` (drop the collapse),
  `paste` (iterate, one commit, select non-locked clones). No other reader of `clipboard`
  exists (keyboard routes Cmd+C/X/V to these actions; it doesn't inspect the shape).
- `src/ui/store/store.test.ts`: update the existing `clipboard (copy/cut/paste)` block to
  read `clipboard?.[0]…`; add multi-object tests.

## 5. Testing

**Store (`store.test.ts`):**
- Existing single-object tests still pass against the list shape (copy 1 → paste 1; cut 1
  → delete + clipboard[0]; frozen snapshot; locked clone not selected).
- copy TWO selected → `clipboard` length 2 → paste → 4 objects, both clones selected, one
  undo step.
- cut TWO selected → both removed + `clipboard` length 2 → paste → 2 objects restored.
- copy order is zOrder-stable (clone relative stacking matches the originals).

**e2e (`multi-clipboard.spec.ts`):** draw two rects, Shift-click both, Cmd+C, Cmd+V →
4 objects; the two pasted clones are selected (two selection outlines distinct from the
originals).

## 6. Risks

- **Truthiness of an empty list:** never store `[]` — `copySelected` returns early when
  nothing is selected, so `clipboard` is either `null` or a non-empty list; `paste`
  guards `!clip || clip.length === 0`.
- **Locked clones:** `paste` selects only non-locked clones (single-object Slice-19
  behavior generalized).
- **zOrder uniqueness:** `nextZOrder` recomputed each loop against the growing project so
  pasted clones get distinct increasing zOrder (same pattern as `duplicateSelected`).
