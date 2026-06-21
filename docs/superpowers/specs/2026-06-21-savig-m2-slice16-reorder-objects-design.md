# M2 Slice 16 — Reorder Objects (z-order) (design)

Date: 2026-06-21
Status: design approved (decisions delegated to implementer; see §8)
Predecessor: Slice 15 — delete object (merged `16320b7`)

## 1. Goal

Let a user change an object's **stacking order** — bring to front / bring forward /
send backward / send to back — via Inspector buttons or keyboard shortcuts. The
render already sorts by `zOrder` (`[...objects].sort((a,b) => a.zOrder - b.zOrder)`,
so higher `zOrder` paints on top), but there is currently no way to change it: new
objects land on top (`nextZOrder = max+1`) and stay there. This completes the
object-management arc (add → duplicate → delete → **reorder**).

Non-goals (deferred, tracked in §9): drag-to-reorder in a layer/timeline list;
multi-object reorder (M4); a per-object zOrder number field.

## 2. Model

Stacking is determined entirely by `zOrder` (the Stage re-sorts on every render),
so reordering is **rewriting `zOrder` values**. Each reorder **reassigns contiguous
`zOrder` `0..N-1`** in the new stacking order. This:
- normalizes the gaps that delete leaves (Slice 15) and prevents unbounded growth,
- keeps `nextZOrder = max+1 = N` correct for the next add,
- is a no-op at the extremes (forward when already frontmost, etc.).

The objects **array order is left unchanged**; only each object's `zOrder` field is
rewritten (array order and `zOrder` are independent — the Stage sorts by `zOrder`).

## 3. Pure helper (new `src/engine/reorder.ts`)

```ts
export type ReorderOp = 'front' | 'forward' | 'backward' | 'back';

/** Reorder the object `id` within the z-stack and return a new objects array with
 *  contiguous zOrders (0..N-1) in the new order. The array element order is
 *  preserved; only each object's `zOrder` is rewritten. Returns the SAME `objects`
 *  reference for a no-op (unknown id, N < 2, or already at the requested extreme),
 *  so the caller can skip the commit. */
export function reorderObjects(objects: SceneObject[], id: string, op: ReorderOp): SceneObject[];
```

Implementation:
- If `objects.length < 2` → return `objects`.
- Build the current stacking order: `objects` sorted ascending by `zOrder` (stable).
- `idx = order.findIndex(o => o.id === id)`; if `-1` → return `objects`.
- Compute the new order:
  - `forward`: if `idx < N-1` swap `idx, idx+1`, else return `objects`.
  - `backward`: if `idx > 0` swap `idx, idx-1`, else return `objects`.
  - `front`: if `idx < N-1` move the target to the end, else return `objects`.
  - `back`: if `idx > 0` move the target to the start, else return `objects`.
- Build `zById = Map(newOrder.map((o, z) => [o.id, z]))`.
- Return `objects.map(o => ({ ...o, zOrder: zById.get(o.id)! }))` (array order
  unchanged; zOrders rewritten to the new ranks).

Pure, framework-free, fully unit-tested (each op on a 3-object stack; no-op at the
extremes returns the same ref; unknown id and N<2 return the same ref; the result's
zOrders are a permutation of `0..N-1`).

## 4. Store — `reorderSelected(op)`

```ts
reorderSelected(op: ReorderOp): void;
```

```ts
reorderSelected(op) {
  const id = get().selectedObjectId;
  if (id == null) return;
  const project = get().history.present;
  const objects = reorderObjects(project.objects, id, op);
  if (objects === project.objects) return;   // no-op -> no commit
  get().commit({ ...project, objects });
}
```

One `commit` → one undo step. Selection is unchanged (the same object stays selected).

## 5. UI

- **Inspector** (`Inspector.tsx`): a row of four buttons beside / below the
  Duplicate/Delete row — "To Front", "Forward", "Backward", "To Back" — each calling
  `reorderSelected('front'|'forward'|'backward'|'back')`. Only shown when an object is
  selected (past the `if (!obj) return …` guard).
- **Keyboard** (`useKeyboard.ts`): with `mod = metaKey || ctrlKey`:
  - `mod && (key === ']' || key === '}')` → `e.preventDefault()`; `shiftKey ? 'front' : 'forward'`.
  - `mod && (key === '[' || key === '{')` → `e.preventDefault()`; `shiftKey ? 'back' : 'backward'`.
  (The shifted bracket arrives as `'}'`/`'{'`, so both key codes are matched and
  `shiftKey` selects the front/back variant.) Placed beside the existing
  `Cmd/Ctrl+D` / `Cmd/Ctrl+Z` mod-key branches.

## 6. Persistence & parity

No persistence/render/runtime/export change — reorder only rewrites `zOrder`
values in the existing project graph (which already round-trips and already sorts by
`zOrder`). No migration (v4).

## 7. Testing

- **Engine unit (`reorder.test.ts`):** 3 objects (a,b,c at zOrder 0,1,2):
  - `forward` on a → a/b swap ranks (a.zOrder 1, b.zOrder 0); `backward` on c → c/b swap.
  - `front` on a → a becomes top (zOrder 2); `back` on c → c becomes bottom (zOrder 0).
  - no-ops: `forward` on c (already front), `backward` on a (already back), unknown id,
    single-object array → return the SAME reference.
  - the returned zOrders are always a permutation of `0..N-1`.
- **Store unit (`store.test.ts`):** `reorderSelected('back')` on the front object
  drops its zOrder below the others (one undo step; undo restores); no-op when nothing
  selected or already at the extreme (no new history entry).
- **Keyboard unit:** `Cmd+]` brings the selected object forward; `Cmd+Shift+[` sends to back.
- **Inspector unit:** the "To Back" button lowers the selected object's zOrder.
- **e2e (Playwright):** draw two overlapping rects (the 2nd is selected, on top) →
  click "To Back" → assert the DOM order of `[data-savig-object]` reversed (the
  selected element moved from last to first — last = front in the zOrder-sorted render).

## 8. Decisions (delegated to implementer, recorded)

1. **Slice = reorder objects (z-order)**: front / forward / backward / back.
2. **Reassign contiguous zOrders 0..N-1** on each reorder; same-ref no-op at extremes.
3. **Pure `reorderObjects(objects, id, op)` helper** + thin `reorderSelected(op)` store action.
4. **Four Inspector buttons** + `Cmd/Ctrl+]`/`[` (Shift = front/back; shifted key codes handled).
5. **One plan.**

## 9. Deferred (tracked)

- Drag-to-reorder in a layer / timeline object list.
- Multi-object reorder; reorder relative to a clicked target.
- A per-object zOrder field; named layers.
- Boolean ops; multi-select / grouping (M4).
