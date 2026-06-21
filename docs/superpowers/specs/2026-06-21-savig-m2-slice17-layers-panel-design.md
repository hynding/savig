# M2 Slice 17 — Layers Panel + Object Visibility (design)

Date: 2026-06-21
Status: design approved (decisions delegated to implementer; see §8)
Predecessor: Slice 16 — reorder objects / z-order (merged `46f96b8`)

## 1. Goal

Give the scene an **overview**: a Layers panel listing every object (front-first),
where the user can **click to select** any object — including ones fully occluded on
the stage, which are currently unselectable — and **toggle each object's visibility**
(hide/show). This is the standard layers-panel core and the natural companion to the
object-management work (add / duplicate / delete / reorder).

Non-goals (deferred, tracked in §9): drag-to-reorder in the panel (Slice-16 buttons/
shortcuts cover reorder); rename; lock; multi-select (M4); suppressing a hidden
object's on-canvas handles when it is selected (minor edge).

## 2. Visibility data model

`SceneObject` gains an optional, persisted field:

```ts
  /** When true, the object is not rendered on the Stage or in the export. */
  hidden?: boolean;
```

`hidden` is part of the saved project and affects export, so toggling it is an
**undoable `commit`** (not transient view state). Optional → **no migration** (absent
== visible; project stays v4).

## 3. Render skip

Two render sites skip hidden objects; nothing else changes:

- **Stage** (`Stage.tsx`): the `ordered` memo filters them out:
  ```ts
  const ordered = useMemo(
    () => [...project.objects].filter((o) => !o.hidden).sort((a, b) => a.zOrder - b.zOrder),
    [project.objects],
  );
  ```
  (`ordered` is used only by the object render map, so this affects the shape render
  only. On-canvas handles for a selected-but-hidden object are out of scope — §9.)
- **Export** (`renderDocument.ts`): in the body map, return early for a hidden object,
  **before** its gradient defs are pushed (so no orphaned `<linearGradient>` lands in
  `<defs>`):
  ```ts
  const obj = objectsById.get(state.objectId)!;
  if (obj.hidden) return '';
  const asset = assetsById.get(obj.assetId);
  …
  ```

**Runtime: unchanged** — a hidden object is not in the exported markup, so the
standalone player never sees it. `computeFrame`/`sampleProject` still process hidden
objects (harmless; only the rendered markup is suppressed).

## 4. Store — `toggleObjectVisibility(id)`

```ts
toggleObjectVisibility(id: string): void;
```

```ts
toggleObjectVisibility(id) {
  const project = get().history.present;
  const obj = project.objects.find((o) => o.id === id);
  if (!obj) return;
  get().commit(replaceObject(project, { ...obj, hidden: !obj.hidden }));
}
```

One `commit` → one undo step. Selection is unchanged.

## 5. Layers panel (new `src/ui/components/LayersPanel/LayersPanel.tsx`)

A panel listing all objects **front-first** (sorted by `zOrder` descending, so the
frontmost object is at the top — the Photoshop/Figma convention):

- Header: "Layers".
- One row per object (`data-testid="layer-<id>"`):
  - the object **name**, clicking the row → `selectObject(o.id)`;
  - the selected object's row is highlighted (`data-selected="true"` + a `styles.selected` class);
  - a **visibility toggle** button (`data-testid="layer-visibility-<id>"`,
    `aria-label="<name> visibility"`, `aria-pressed={!o.hidden}`) showing an eye/▢
    glyph; its `onClick` calls `e.stopPropagation()` then `toggleObjectVisibility(o.id)`
    (so toggling does not also re-select). A hidden row is dimmed (`styles.hidden`).
- Empty state: a "No objects" hint when there are none.

Mounted in `App.tsx` inside the existing left `assets` `<section>`, below `<AssetPanel />`
(both stack in the 220px left column; no grid change). A small `aria-label="Layers"`
region wrapper is fine.

## 6. Persistence & parity

`hidden` is an optional field — absent round-trips byte-identically; no migration
(v4). Export already serializes the object graph; the render skip is the only export
change (hidden objects produce no markup). No runtime bundle change.

## 7. Testing

- **Store unit (`store.test.ts`):** `toggleObjectVisibility` flips `hidden` (undoable —
  undo restores); no-op for an unknown id.
- **Stage unit (`Stage.test.tsx`):** a hidden object renders no `[data-savig-object]`
  for it (the other objects still render).
- **Export unit (`renderDocument.test.ts`):** a hidden object contributes no markup
  (its `data-savig-object` / shape is absent from the output) AND no orphaned gradient
  def (a hidden object with a fill gradient emits no `<linearGradient>`).
- **Layers panel unit (`LayersPanel.test.tsx`):** lists objects front-first; clicking a
  row selects that object; the selected row is marked; clicking the eye toggles
  `hidden` (and does NOT change the selection).
- **e2e (Playwright):** draw two rects → open the Layers panel → click the back
  object's row (selects the occluded one) → toggle its visibility → assert one fewer
  `[data-savig-object]` renders; toggle again → it returns.

## 8. Decisions (delegated to implementer, recorded)

1. **Slice = layers panel + per-object visibility.**
2. **Front-first list** (zOrder desc); row click selects; eye toggles hide/show (stopPropagation).
3. **`hidden?: boolean` on SceneObject** (persisted, undoable, no migration); `toggleObjectVisibility(id)`.
4. **Render skip** in Stage (`ordered` filter) + export (`renderDocument` early-return before gradient defs); runtime unchanged.
5. **Panel in the left `assets` column** below AssetPanel; no new engine pure helper.
6. **One plan.**

## 9. Deferred (tracked)

- Drag-to-reorder within the panel; rename; lock; per-object opacity quick control.
- Suppressing a selected hidden object's on-canvas handles/overlays (minor edge).
- Multi-select; layer groups / folders (M4).
