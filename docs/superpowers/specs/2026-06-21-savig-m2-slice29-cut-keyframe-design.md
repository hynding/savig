# M2 Slice 29 — Cut keyframe (design)

Date: 2026-06-21
Status: design approved (decisions delegated to implementer; see §6)
Predecessor: Slice 28 — uniform scale & resize (merged `d17c4a0`)

## 1. Goal

Complete the keyframe clipboard: **Cmd/Ctrl+X on a selected keyframe cuts it** (copy +
remove). Slice 24 added copy/paste and deliberately made Cmd/Ctrl+X a no-op while a
keyframe was selected ("cut-keyframe deferred"); Slice 25 added drag-to-retime. This slice
closes that gap, so the keyframe clipboard is copy (S24) / paste (S24) / retime (S25) /
**cut (S29)**.

It also extracts the 6-branch keyframe-removal routing — currently inlined in the
`useKeyboard` Delete chain — into a single `deleteSelectedKeyframe()` store action, reused
by both Delete and the new cut (DRY).

Non-goals (deferred, §7): cut/copy of a multi-keyframe selection; cross-object keyframe
paste; cutting in the timeline via a context menu.

## 2. Store — `deleteSelectedKeyframe()` (extracted) + `cutKeyframe()`

The Delete chain in `useKeyboard` currently routes the six selectable keyframe types to
their existing `remove*` actions. Extract exactly that routing into a store action:

```ts
deleteSelectedKeyframe(): void;   // removes whichever of the 6 keyframe types is selected; no-op if none
cutKeyframe(): void;              // copyKeyframe() then deleteSelectedKeyframe()
```

```ts
deleteSelectedKeyframe() {
  const s = get();
  if (s.selectedProgressKeyframe) s.removeSelectedProgressKeyframe();
  else if (s.selectedGradientKeyframe) s.removeSelectedGradientKeyframe();
  else if (s.selectedColorKeyframe) s.removeSelectedColorKeyframe();
  else if (s.selectedDashKeyframe) s.removeSelectedDashKeyframe();
  else if (s.selectedShapeKeyframe) s.removeShapeKeyframe();
  else if (s.selectedKeyframe) s.removeSelectedKeyframe();
},
cutKeyframe() {
  get().copyKeyframe();          // snapshot the selected keyframe into keyframeClipboard (S24); no commit
  get().deleteSelectedKeyframe(); // then remove it (one commit; clears the selection)
},
```

The routing **order and per-type checks are identical** to the existing Delete chain
(progress → gradient → color → dash → shape → scalar), so extracting it is behaviour-
preserving. Only one keyframe selection is ever set at a time (each `selectXKeyframe`
clears the others), so the order never conflicts. `cutKeyframe` copies BEFORE deleting, so
the cut keyframe lands in `keyframeClipboard` (mutually exclusive with the object clipboard
— S24) and can be pasted; the subsequent `delete` is the single `commit`.

## 3. `useKeyboard` — DRY the Delete chain + wire Cmd/Ctrl+X

- **Delete / Backspace:** replace the six inline keyframe branches with one call to the new
  action (the `kfSelected` boolean is already computed earlier in the handler and in scope):

```ts
      if (s.activeTool === 'node' && s.selectedNodeIndex != null) s.deleteSelectedNode();
      else if (kfSelected) s.deleteSelectedKeyframe();
      else if (s.selectedObjectId) s.deleteSelectedObject();
```

- **Cmd/Ctrl+X:** route by keyframe-priority (mirrors Cmd/Ctrl+C from S24):

```ts
      if (mod && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        if (kfSelected) s.cutKeyframe();
        else s.cut();
        return;
      }
```

The node-mode delete and the object-delete fallthrough are unchanged. Cmd/Ctrl+X on an
object (no keyframe selected) still cuts the object (S21).

## 4. Persistence & parity

No engine/store-shape/persistence/render/runtime/export/migration change — `cutKeyframe`
and `deleteSelectedKeyframe` are thin compositions of existing actions. The clipboard is
transient (S24). Stays v4.

## 5. Edge cases

- **No keyframe selected:** `deleteSelectedKeyframe`/`cutKeyframe` are no-ops; Cmd/Ctrl+X
  falls through to object cut; Delete falls through to object delete (unchanged).
- **Cut then paste:** `cutKeyframe` leaves the keyframe in `keyframeClipboard`, so a
  following Cmd/Ctrl+V (routed to `pasteKeyframe` since `keyframeClipboard` is non-null)
  re-inserts it at the playhead on the same track (S24 semantics).
- **Behaviour-preserving extraction:** Delete with a keyframe selected removes exactly the
  same keyframe as before (same routing); the existing Delete tests must still pass.

## 6. Decisions (delegated to implementer, recorded)

1. **Slice = cut-keyframe** (Cmd/Ctrl+X on a selected keyframe = copy + remove), completing
   the keyframe clipboard.
2. **Extract `deleteSelectedKeyframe()`** (the 6-branch keyframe removal) from the
   `useKeyboard` Delete chain; reuse it for both Delete and cut (DRY); add `cutKeyframe()` =
   copy + delete.
3. **Keyboard:** Delete uses `deleteSelectedKeyframe`; Cmd/Ctrl+X routes `kfSelected ?
   cutKeyframe : cut`.
4. **Editor-only** — thin compositions of existing actions; no engine/persistence change.
5. **One plan.**

## 7. Deferred (tracked)

- Cut/copy/paste of a MULTI-keyframe selection or a time range.
- Cross-object keyframe paste (pasteKeyframe still targets the copied keyframe's own object).
- A timeline right-click "Cut keyframe" menu item.

## 8. Testing

- **Store unit (`store.test.ts`):**
  - `deleteSelectedKeyframe` removes the selected **scalar** keyframe (and is a no-op when
    no keyframe is selected); same for a **color** and a **shape** keyframe (the routing
    covers the structurally-distinct types).
  - `cutKeyframe` snapshots the selected keyframe into `keyframeClipboard` AND removes it
    from its track (one history entry); a subsequent `pasteKeyframe` at a new playhead time
    re-inserts it (round-trip — value/easing preserved).
- **Keyboard unit (`useKeyboard.test.ts`):**
  - Cmd/Ctrl+X with a scalar keyframe selected cuts it (`keyframeClipboard` set, the
    keyframe gone) and does NOT cut the object; with NO keyframe selected, Cmd/Ctrl+X cuts
    the object (S21 behaviour intact).
  - Delete with a keyframe selected still removes that keyframe (the extracted routing); a
    regression check that Delete with no keyframe still deletes the selected object.
- **e2e (Playwright):** draw a rect → key rotation at t=0 → select the rotation diamond →
  Cmd/Ctrl+X → the `…-rotation-0` diamond is gone → move the playhead to t=1 → Cmd/Ctrl+V →
  a `…-rotation-1` diamond appears (cut → paste round-trip).
