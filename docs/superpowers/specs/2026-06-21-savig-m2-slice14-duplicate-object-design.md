# M2 Slice 14 — Duplicate Object (design)

Date: 2026-06-21
Status: design approved (decisions delegated to implementer; see §8)
Predecessor: Slice 13 — onion skinning (merged `1f2c765`)

## 1. Goal

Let a user **duplicate the selected object** — a full independent copy with all its
animation — via `Cmd/Ctrl+D` or an Inspector button. This is the most fundamental
missing workflow primitive: you can build a richly-animated element but cannot make
a second one without redrawing.

Non-goals (deferred, tracked in §9): cross-session copy/paste; a duplicate-with-
shared-asset (linked clone) option for vectors; multi-select duplicate (M4);
duplicating audio clips (a separate entity, not a scene object).

## 2. The asset fork (the crux)

A duplicate must be **independent**, and what "independent" requires depends on the
asset kind:

- **Vector object** → the `VectorAsset` holds the `path` + `style` (fill/stroke/
  gradients/dash). Sharing it would mean editing the copy's path/style mutates the
  original. So the duplicate **CLONES the vector asset** (new asset id, deep copy)
  and points at the clone.
- **Imported SVG object** → the `SvgAsset` is the instanced `<use>` model; multiple
  objects already share one svg asset (that is exactly what `addObject` does). So a
  duplicated SVG object **SHARES** the asset (same `assetId`).
- **Audio** → not a `SceneObject`; out of scope.

All *animation* (transform/geometry/morph/color/gradient/dash/motion tracks) lives
on the **object**, so it copies with the object regardless of asset kind.

## 3. Pure helper (new `src/engine/duplicate.ts`)

```ts
/** Deep-clone a scene object for duplication. The clone gets `ids.objectId`, name
 *  "<name> copy", and its base translation offset by `offset` in x and y. For a
 *  VECTOR asset, also returns a cloned asset with `ids.assetId` and re-points the
 *  object at it (independent path/style); for any other asset kind the object keeps
 *  its original `assetId` and no asset is returned (shared/instanced). */
export function duplicateObject(
  obj: SceneObject,
  asset: Asset | undefined,
  ids: { objectId: string; assetId: string },
  offset: number,
): { object: SceneObject; clonedAsset?: VectorAsset };
```

Implementation:
- Deep-clone via the project's own serialization model: `JSON.parse(JSON.stringify(obj))`
  (the object graph is JSON-plain by design — it persists as JSON; keyframes hold
  only plain data). This guarantees full reference independence with no
  `structuredClone` environment question.
- Set `object.id = ids.objectId`, `object.name = `${obj.name} copy``,
  `object.base = { ...base, x: base.x + offset, y: base.y + offset }`.
- `zOrder` is left as-cloned; the **store** sets it to the top (§4) so two objects
  never tie. (The helper does not know the project's object count.)
- If `asset?.kind === 'vector'`: `clonedAsset = { ...JSON.parse(JSON.stringify(asset)),
  id: ids.assetId }`; `object.assetId = ids.assetId`; return both. Else return only
  `{ object }` (assetId unchanged).

Pure, framework-free, fully unit-tested (new ids; "copy" name; offset; vector clone
vs svg share; deep independence — mutating the clone's tracks/asset leaves the
original untouched).

## 4. Store — `duplicateSelected()`

```ts
duplicateSelected(): void;
```

```ts
duplicateSelected() {
  const project = get().history.present;
  const obj = project.objects.find((o) => o.id === get().selectedObjectId);
  if (!obj) return;                       // no-op when nothing selected
  const asset = project.assets.find((a) => a.id === obj.assetId);
  const { object, clonedAsset } = duplicateObject(
    obj, asset, { objectId: newId(), assetId: newId() }, DUP_OFFSET, // DUP_OFFSET = 10
  );
  const placed = { ...object, zOrder: project.objects.length };       // on top
  get().commit({
    ...project,
    assets: clonedAsset ? [...project.assets, clonedAsset] : project.assets,
    objects: [...project.objects, placed],
  });
  get().selectObject(placed.id);          // select the copy + clear keyframe selections
}
```

One `commit` → one undo step. `selectObject` resets the keyframe/node selections.

## 5. UI

- **Keyboard** (`useKeyboard.ts`): a `mod && (key === 'd' || 'D')` branch (the handler
  already computes `mod = metaKey || ctrlKey`), placed beside the `Cmd/Ctrl+Z` block;
  calls `e.preventDefault()` (Cmd+D is the browser bookmark) then `s.duplicateSelected()`.
- **Inspector** (`Inspector.tsx`): a "Duplicate" button at the top of the panel (only
  shown when an object is selected — it is past the `if (!obj) return …` guard) that
  calls `duplicateSelected()`.

## 6. Persistence & parity

No persistence/render/runtime/export change. A duplicate is just more objects/assets
in the existing project graph (which already round-trips). No migration (v4).

## 7. Testing

- **Engine unit (`duplicate.test.ts`):**
  - vector object: clone has a new object id + a new asset id; `object.assetId`
    points at the cloned asset; name is "<name> copy"; base offset applied; all
    tracks copied; mutating the clone's `tracks`/asset `style` does NOT change the
    original (deep independence).
  - svg object: clone keeps the SAME `assetId`; no `clonedAsset` returned.
- **Store unit (`store.test.ts`):**
  - `duplicateSelected` on a vector adds one object + one asset, selects the copy,
    is one undo step (undo removes both), copy is offset and on top (`zOrder`).
  - no-op when nothing is selected.
- **Inspector unit:** the Duplicate button calls `duplicateSelected` (object count +1).
- **e2e (Playwright):** draw a rect → click Duplicate → assert two
  `[data-savig-object]` elements exist and the duplicate is the selected one
  (`[data-selected="true"]`). Asset independence is covered by the unit test.

## 8. Decisions (delegated to implementer, recorded)

1. **Slice = duplicate object** (fundamental build-once-reuse primitive; well-bounded).
2. **Deep-clone the object** + all animation; new id; "copy" name; offset `+10,+10`; on top; selected; one undo step.
3. **Vector → clone the asset; imported SVG → share the asset; audio → N/A.**
4. **Pure `duplicateObject` helper** (JSON deep-clone) + thin `duplicateSelected` store action.
5. **`Cmd/Ctrl+D`** (preventDefault) + an Inspector "Duplicate" button.
6. **One plan.**

## 9. Deferred (tracked)

- Cross-session copy/paste (clipboard); paste-in-place vs paste-at-cursor.
- Linked clone (vector duplicate that SHARES the asset) as an option.
- Multi-select duplicate; duplicating audio clips.
- Boolean ops; multi-select / grouping (M4).
