# M2 Slice 19 — Object Lock (design)

Date: 2026-06-21
Status: design approved (decisions delegated to implementer; see §7)
Predecessor: Slice 18 — rename object (merged `fa6830d`)

## 1. Goal

Let a user **lock an object** so it cannot be accidentally edited. A locked object
still renders, animates, and exports exactly as before, but on the stage it is
**non-interactive**: it cannot be selected, moved, resized, rotated, gradient-dragged,
or deleted. Lock is toggled from the Layers panel, next to the visibility eye.

This completes the Layers-panel organizational trio: **select (S17) → visibility (S17)
→ rename (S18) → lock (S19)**. Lock is the exact data/UX sibling of `hidden`.

Non-goals (deferred, tracked in §8): locking on the stage / via keyboard shortcut;
lock affecting export or playback; locking assets; lock + multi-select (M4); a
"lock all / unlock all" affordance.

## 2. Data

One optional field on `SceneObject`:

```ts
locked?: boolean; // absent === unlocked
```

Persisted (round-trips generically like `hidden`), undoable. **No migration / version
bump** — an absent field reads as unlocked, so all existing v4 projects load unchanged.

## 3. Store — `toggleObjectLock(id)`

```ts
toggleObjectLock(id: string): void;
```

```ts
toggleObjectLock(id) {
  const project = get().history.present;
  const obj = project.objects.find((o) => o.id === id);
  if (!obj) return;                                  // unknown id -> no-op
  const locking = !obj.locked;
  get().commit(replaceObject(project, { ...obj, locked: locking }));
  if (locking && get().selectedObjectId === id) get().selectObject(null);
}
```

One `commit` → one undo step (mirrors `toggleObjectVisibility`). **The selection-clear
is the load-bearing invariant:** locking the currently-selected object also deselects it
(Figma's deselect-on-lock). That single rule yields *locked ⇒ not selected ⇒ no handles
and no keyboard ops*, so neither `useKeyboard` (Delete/duplicate/nudge all key off
`selectedObjectId`) nor the Inspector needs any lock-specific wiring.

`selectObject(null)` is transient (not in history); on undo the lock reverts while the
selection stays cleared, which is acceptable (you click to reselect).

## 4. Stage interaction

Two changes, both in `Stage.tsx`:

**(a) Click/drag is inert on a locked object.** `onObjectPointerDown(id, e)` returns
early when the object is locked — **without** calling `selectObject` or
`e.stopPropagation()`. Because it does not stop propagation, the pointer-down bubbles to
the SVG background handler (`onBackgroundPointerDown` → `selectObject(null)` under the
select tool), so clicking a locked object **deselects** (clicks "through" it, Figma-like).

```ts
const onObjectPointerDown = (id: string, e: ReactPointerEvent) => {
  const target = useEditor.getState().history.present.objects.find((o) => o.id === id);
  if (target?.locked) return; // inert: let the event bubble to the background (deselect)
  e.stopPropagation();
  selectObject(id);
  // ...existing move-drag logic unchanged...
};
```

**(b) No handles on a locked (or hidden) selected object.** The three selection-overlay
memos — `selectedVector` (resize), `selectedGradient`, `selectedRotatable` — gain
`|| obj.hidden || obj.locked` in their early-return guard:

```ts
if (!obj || obj.hidden || obj.locked || /* …existing… */) return null;
```

The `locked` clause is belt-and-suspenders (§3 already deselects on lock). The `hidden`
clause **also closes the Slice-17 deferred papercut** "selecting a hidden object still
shows its on-canvas handles" — now a selected object that is hidden shows no handles
either. Both cases are tested.

No other Stage change: locked objects still render in the `ordered` map (lock does not
hide), still register their nodes for playback.

## 5. Layers panel (`LayersPanel.tsx`)

Add a lock toggle button to each row, before the existing eye:

- `data-testid="lock-<id>"`, `aria-label="${o.name} lock"`, `aria-pressed={!!o.locked}`,
  `className={styles.eye}` (reuse the icon-button style), `onClick` calls
  `stopPropagation()` then `toggleObjectLock(o.id)`.
- Glyph: `🔒` when locked, `🔓` when unlocked (always shown, mirroring the always-visible
  eye).

The row's `onClick` is guarded so a locked object cannot be selected from the panel
either (keeps the *locked ⇒ not selected* invariant):

```tsx
onClick={() => { if (!o.locked) selectObject(o.id); }}
```

Optional light styling: a `.locked` class (dim the name) — analogous to the existing
`.hidden` rule. The inline-rename (S18) still works on a locked row via double-click
(renaming is metadata, not a stage edit); this is intentional and harmless.

## 6. Persistence & parity

No render/export/runtime change. `locked` serializes with the object graph (like
`hidden`), no migration (stays v4). Locked objects export and animate identically to
unlocked ones — lock is purely an editor interaction gate.

## 7. Decisions (delegated to implementer, recorded)

1. **Slice = object lock** (Layers-panel toggle; editor-only non-interaction).
2. **`locked?: boolean`** on SceneObject; persisted, undoable, absent==unlocked, no migration.
3. **`toggleObjectLock(id)`** — commit flip, no-op unknown id, **deselect-on-lock** of the
   selected object (the invariant that keeps keyboard/Inspector lock-free).
4. **Stage:** locked-object pointer-down is inert and bubbles to background (deselect);
   handle memos suppress on `hidden || locked` (also fixes the S17 hidden-handles papercut).
5. **Layers panel:** lock button (`lock-<id>`) before the eye; row-click guarded for locked.
6. **Editor-only** — no render/export/runtime/migration change.
7. **One plan.**

## 8. Deferred (tracked)

- Lock toggle on the stage / a keyboard shortcut; "lock all / unlock all".
- Click-**through** a locked object to select the unlocked object *behind* it. v1 makes a
  locked-object click deselect (bubbles to background); selecting an occluded object is
  done via the Layers panel. True click-through would need `pointer-events:none` on the
  locked group (declarative, but not behaviorally unit-testable in jsdom — chosen against
  for testability + simplicity).
- Lock affecting export or playback (it deliberately does not).
- Locking assets; lock state in a future timeline object-row.
- Lock interaction with multi-select / groups (M4).
- A distinct locked cursor / on-canvas locked affordance.

## 9. Testing

- **Store unit (`store.test.ts`):** `toggleObjectLock` sets `locked` (undoable — undo
  restores); no-op for an unknown id; locking the **selected** object clears
  `selectedObjectId`; locking a **non-selected** object leaves the selection intact;
  unlocking never changes selection.
- **Layers-panel unit (`LayersPanel.test.tsx`):** the `lock-<id>` button toggles
  `locked` (and `aria-pressed`); clicking a **locked** row does **not** select the object;
  the eye and rename still work on a locked row.
- **Stage unit (`Stage.test.tsx`):** a pointer-down on a locked object does not select it
  (selection unchanged / cleared, not set to that id); a selected object that becomes
  `locked` renders **no** `resize-handles` overlay; a selected object that is `hidden`
  renders no `resize-handles` overlay (the S17 papercut).
- **e2e (Playwright):** draw a rect (auto-selected → `resize-handles` visible) → click its
  `lock-<id>` in the Layers panel → the `resize-handles` overlay disappears AND clicking
  the shape on the stage does not bring them back (still locked, non-interactive); the
  object still renders (`[data-savig-object]` count unchanged).
