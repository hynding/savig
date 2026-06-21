# M2 Slice 21 — Clipboard: copy / cut / paste objects (design)

Date: 2026-06-21
Status: design approved (decisions delegated to implementer; see §7)
Predecessor: Slice 20 — layers drag-to-reorder (merged `c12a010`)

## 1. Goal

Add an object **clipboard**: **Cmd/Ctrl+C** copies the selected object, **Cmd/Ctrl+X**
cuts it (copy + delete), **Cmd/Ctrl+V** pastes a copy. Duplicate (Cmd+D, Slice 13)
already clones-in-place, but a clipboard adds the semantics users expect: **cut**
(remove now, re-place later), **copy-once / paste-many**, and paste after navigating
away. Paste reuses the exact `duplicateObject` cloning, so a paste and a duplicate
produce identical clones.

Non-goals (deferred, tracked in §8): the OS/system clipboard (`navigator.clipboard`)
for cross-application/-tab paste; paste-at-cursor-position; copying more than one object
(M4 multi-select); a per-paste cascade offset.

## 2. Clipboard state

A new transient store field:

```ts
clipboard: { object: SceneObject; asset?: Asset } | null;
```

- **Transient** — not part of `history` (undo never touches it) and **not** in
  `TRANSIENT_DEFAULTS`, so `newProject`/`loadProject` (which spread
  `TRANSIENT_DEFAULTS`) leave it intact. Initial value `null`. Persisting it across
  `newProject` is what enables pasting a copied object into a freshly-created project.
- **Frozen by immutability** — the store never mutates an object or asset in place
  (every edit `commit`s new `{...obj}` references), so the references captured at copy
  time are an immutable snapshot. No deep clone is needed at copy time; `duplicateObject`
  deep-clones on paste.

## 3. Store actions

```ts
copySelected(): void;
cut(): void;
paste(): void;
```

```ts
copySelected() {
  const project = get().history.present;
  const obj = project.objects.find((o) => o.id === get().selectedObjectId);
  if (!obj) return; // nothing selected -> no-op
  const asset = project.assets.find((a) => a.id === obj.assetId);
  set({ clipboard: { object: obj, asset } }); // refs are immutable snapshots; no commit (not document state)
},
cut() {
  get().copySelected();
  get().deleteSelectedObject(); // already lock-guarded: cutting a locked object copies but does not remove
},
paste() {
  const clip = get().clipboard;
  if (!clip) return; // empty clipboard -> no-op
  const project = get().history.present;
  const { object, clonedAsset } = duplicateObject(
    clip.object,
    clip.asset,
    { objectId: newId(), assetId: newId() },
    DUP_OFFSET,
  );
  const placed = { ...object, zOrder: nextZOrder(project.objects) };
  // Ensure the referenced asset exists: clonedAsset for a vector asset; otherwise
  // re-add the clipboard's (shared/svg) asset if the project no longer has it
  // (cross-project paste). Same-project paste of a shared asset is a no-op here.
  let assets = project.assets;
  if (clonedAsset) assets = [...assets, clonedAsset];
  else if (clip.asset && !assets.some((a) => a.id === placed.assetId)) assets = [...assets, clip.asset];
  get().commit({ ...project, assets, objects: [...project.objects, placed] });
  get().selectObject(placed.id);
},
```

- `copySelected`/`cut` are no-ops when nothing is selected. `paste` is a no-op when the
  clipboard is empty. `paste` is one `commit` → one undo step and selects the new copy.
- Paste reuses `duplicateObject`, so the copy is named `"<name> copy"`, offset by
  `DUP_OFFSET`, and — for a VECTOR asset — gets an independent cloned asset; for a shared
  imported-SVG asset it keeps the asset id (re-added only if missing, per the comment).
- Repeated pastes from the same clipboard land at the same offset (they stack); the user
  drags them apart. A per-paste cascade offset is deferred (§8).

## 4. Keyboard (`useKeyboard.ts`)

Add three modifier shortcuts in the `mod` (Cmd/Ctrl) block, **before** the `switch` (so
`Cmd+V` does not fall through to the bare-`v` "select tool" case), each `preventDefault`
+ `return` like the existing `Cmd+D`:

```ts
if (mod && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); s.copySelected(); return; }
if (mod && (e.key === 'x' || e.key === 'X')) { e.preventDefault(); s.cut(); return; }
if (mod && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); s.paste(); return; }
```

The existing `isEditable(e.target)` early-return at the top of the handler means typing
in an `<input>`/`<textarea>`/contentEditable still gets native copy/cut/paste — these
shortcuts only fire when focus is on the canvas/app chrome. `copySelected`/`cut` no-op
without a selection and `paste` no-ops with an empty clipboard, so the keys are safe to
press anytime.

## 5. Persistence & parity

No persistence/render/runtime/migration change. The clipboard is transient store state
(never serialized). Paste is an ordinary object (+ optional asset) addition — the same
commit shape as duplicate — so it round-trips, exports, and animates like any object.
Stays v4.

## 6. Edge cases

- **Cut of a locked object:** `deleteSelectedObject` already no-ops on a locked object
  (Slice 19), so cut copies it but does not remove it — consistent with "locked can't be
  deleted." (A locked object is only ever the selection via the Slice-19 timeline
  residual; normally it is deselected and cannot be the copy source.)
- **Paste preserves the copy's `hidden`/`locked` flags** (it is a faithful
  `duplicateObject` clone). This mirrors duplicate exactly; no special-casing.
- **Cross-project paste** of an imported-SVG object re-adds the clipboard's svg asset
  (the asset-existence check in `paste`), so the pasted object still renders.

## 7. Decisions (delegated to implementer, recorded)

1. **Slice = object clipboard** (copy / cut / paste) via Cmd/Ctrl+C/X/V, reusing `duplicateObject`.
2. **Transient `clipboard` state** outside `TRANSIENT_DEFAULTS` (persists across `newProject`); refs are immutable snapshots (no deep clone at copy).
3. **`copySelected` / `cut` (= copy + delete) / `paste`** store actions; paste re-adds a missing asset for cross-project paste; paste is one undo step and selects the copy.
4. **Keyboard** Cmd/Ctrl+C/X/V before the tool-switch, under the existing `isEditable` guard.
5. **Editor-only** — no persistence/render/runtime/migration change.
6. **One plan.**

## 8. Deferred (tracked)

- OS/system clipboard (`navigator.clipboard.writeText` of a serialized object) for
  cross-application / cross-tab copy-paste.
- Paste-at-cursor (paste centered on the pointer / viewport) instead of a fixed offset.
- A per-paste cascade offset so repeated pastes don't stack.
- Copying / pasting multiple objects at once; copy/paste of keyframes (a separate slice);
  copy/paste across groups — all M4 / later.

## 9. Testing

- **Store unit (`store.test.ts`):**
  - `copySelected` populates `clipboard` with the selected object (no-op when nothing
    selected; no history entry); the snapshot is frozen — editing the source after copy
    does not change what `paste` produces.
  - `paste` adds a new object (fresh id, offset `DUP_OFFSET`, named `"… copy"`, selected),
    clones a vector object's asset (independent asset id), and is exactly one history
    entry; `paste` with an empty clipboard is a no-op.
  - `cut` copies then deletes the selected object (object count drops by one, clipboard
    set); `cut` of a locked object copies it but leaves it in place.
  - cross-project paste: copy an imported-SVG object, `newProject()`, `paste` → the object
    is added AND its svg asset is present in the new project.
- **Keyboard unit (`useKeyboard.test.ts`):** Cmd/Ctrl+C, +X, +V dispatch
  `copySelected`/`cut`/`paste`; a keydown whose target is an `<input>` does NOT (native
  clipboard preserved).
- **e2e (Playwright):** draw a rect → Cmd/Ctrl+C → Cmd/Ctrl+V → two objects render
  (`[data-savig-object]` count is 2), the second offset from the first.
