# M2 Slice 15 — Delete Object (design)

Date: 2026-06-21
Status: design approved (decisions delegated to implementer; see §8)
Predecessor: Slice 14 — duplicate object (merged `a703a4e`)

## 1. Goal

Let a user **delete the selected object** via `Delete`/`Backspace` or an Inspector
button. This completes the object lifecycle — add (Slice 1) → duplicate (Slice 14)
→ delete — and closes a glaring gap: today there is **no way to remove a scene
object** once created.

Non-goals (deferred, tracked in §9): multi-delete (needs multi-select = M4); a
confirmation dialog (undo suffices); asset-management UI; deleting audio clips (a
separate entity, not a scene object).

## 2. Asset pruning (mirror of the duplicate fork)

Deleting an object should not leave orphaned assets:

- **Vector object** → its `VectorAsset` is 1:1 with the object, so deleting the
  object always orphans the asset → **prune it**.
- **Imported SVG object** → its `SvgAsset` may be **shared** (Slice 14's
  duplicate-svg shares it; `addObject` can reference an existing asset). So prune
  **only when no remaining object references it** — checked against the object list
  *after* the target is removed.
- **No binary cleanup**: only audio assets carry binaries, and audio assets are
  referenced by `audioClips`, never by scene objects. Deleting a visual object can
  never orphan a binary. (Binaries are transient store state, outside `Project`/history.)

## 2.1 zOrder robustness (necessitated by delete)

Delete leaves **gaps** in the `zOrder` sequence (delete the object at zOrder 1 from
`[0,1,2]` → survivors `[0,2]`). The existing add paths (`addObject`/`addVectorShape`/
`addVectorPath`) set `zOrder = project.objects.length`, which assumes a contiguous
`0..N-1` sequence — so after a delete-induced gap, a new object can **collide** with
an existing zOrder. (The Slice-14 review flagged this as "a real bug as soon as a
delete action exists"; that action is this slice.)

Fix: a shared `nextZOrder(objects) = max(zOrder) + 1` (the same formula Slice 14
already uses for duplicate). All four creation paths — `addObject`, `addVectorShape`,
`addVectorPath`, and `duplicateSelected` — use it. Gaps then never cause collisions,
and "on top" is always correct. Survivors' zOrders are left as-is (gaps are harmless
to the stable `zOrder || index` sort).

## 3. Pure helper (new `src/engine/removeObject.ts`)

```ts
/** Remove the object with `objectId` from the project, and prune its asset if no
 *  remaining object references it (vector assets are 1:1 → always pruned; a shared
 *  svg asset is kept). Returns the project unchanged (same reference) when the id is
 *  not found, so the caller can no-op. */
export function removeObject(project: Project, objectId: string): Project;
```

Implementation:
```ts
const obj = project.objects.find((o) => o.id === objectId);
if (!obj) return project;                                   // unchanged ref -> caller no-ops
const objects = project.objects.filter((o) => o.id !== objectId);
const assetStillUsed = objects.some((o) => o.assetId === obj.assetId);
const assets = assetStillUsed
  ? project.assets
  : project.assets.filter((a) => a.id !== obj.assetId);
return { ...project, objects, assets };
```

Pure, framework-free, fully unit-tested (vector: object + asset removed; shared svg:
object removed, asset kept while a sibling references it; unknown id: same reference
returned; zOrder of survivors is untouched — the sort is stable enough that no
renumber is needed).

## 4. Store — `deleteSelectedObject()`

```ts
deleteSelectedObject(): void;
```

```ts
deleteSelectedObject() {
  const id = get().selectedObjectId;
  if (id == null) return;
  const project = get().history.present;
  const next = removeObject(project, id);
  if (next === project) return;          // unknown id -> no-op
  get().commit(next);
  get().selectObject(null);              // clears object + all keyframe/node selections
}
```

One `commit` → one undo step (object + pruned asset restored atomically).
`selectObject(null)` is transient (no second history entry).

## 5. UI

- **Keyboard** (`useKeyboard.ts`): object deletion is the **last** fallback in the
  `Delete`/`Backspace` chain — keyframe/node deletion still wins when one is
  selected. The current final `else s.removeSelectedKeyframe();` becomes:
  ```ts
  else if (s.selectedKeyframe) s.removeSelectedKeyframe();
  else if (s.selectedObjectId) s.deleteSelectedObject();
  ```
- **Inspector** (`Inspector.tsx`): a "Delete" button beside the "Duplicate" button
  (only shown when an object is selected, past the `if (!obj) return …` guard) that
  calls `deleteSelectedObject()`.

## 6. Persistence & parity

No persistence/render/runtime/export change. Deleting is just fewer objects/assets
in the existing project graph (which already round-trips). No migration (v4).

## 7. Testing

- **Engine unit (`removeObject.test.ts`):**
  - vector object: removed object + its asset pruned (assets length drops by 1).
  - shared svg asset (two objects, same `assetId`): delete one → object removed,
    asset KEPT (still referenced by the sibling).
  - unknown id → same project reference returned (no-op signal).
- **Store unit (`store.test.ts`):**
  - `deleteSelectedObject` on a vector removes object + asset, clears selection, is
    one undo step (undo restores both); no-op when nothing selected.
  - **zOrder regression:** add three objects, delete the middle one, add a new one →
    the new object's `zOrder` is unique and strictly greater than every survivor's
    (no collision from the delete-induced gap).
- **Keyboard unit:** `Delete` with an object selected (no keyframe selected) removes
  the object; `Delete` with a keyframe selected removes the keyframe (object stays).
- **Inspector unit:** the Delete button removes the selected object (count → 0).
- **e2e (Playwright):** draw two rects → select one → press Delete → assert one
  `[data-savig-object]` remains.

## 8. Decisions (delegated to implementer, recorded)

1. **Slice = delete object** (completes the add → duplicate → delete lifecycle).
2. **Delete the object + prune its asset iff unreferenced** (vector always; shared svg kept).
   Plus: a shared `nextZOrder` (max+1) across all four creation paths, so delete-induced
   zOrder gaps can't cause collisions (§2.1).
3. **Pure `removeObject(project, id)` helper** + thin `deleteSelectedObject` store action + `selectObject(null)`.
4. **`Delete`/`Backspace` (last fallback, after keyframe deletion) + an Inspector "Delete" button.**
5. **One plan.**

## 9. Deferred (tracked)

- Multi-delete; a confirmation dialog for large deletions.
- Asset-management / unused-asset cleanup UI.
- Deleting audio clips (a separate entity).
- Boolean ops; multi-select / grouping (M4).
