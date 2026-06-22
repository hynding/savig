# M2 Slice 27 — Lock-aware timeline (design)

Date: 2026-06-21
Status: design approved (decisions delegated to implementer; see §6)
Predecessor: Slice 26 — edge scale handles (merged `833ed64`)

## 1. Goal

Make the **timeline respect object lock**, closing the Slice-19 lock residual. Locking an
object (S19) deselects it and blocks stage selection/drag, the Inspector, and on-canvas
handles — but its keyframes in the **timeline** can still be clicked to select,
copy/pasted, and (since Slice 25) **dragged to retime**. The timeline is the last
selection path that ignores lock, and S25's drag-retime made the violation tangible (you
can drag a locked object's keyframe to a new time).

This slice makes a locked object's timeline row **non-interactive** (no select, no
keyframe select, no retime drag) and **dimmed**, so *locked means locked everywhere*.

Non-goals (deferred, §7): hiding/collapsing a locked object's lane; a per-lane lock
toggle in the timeline; store-level guards on the keyframe-select actions (the timeline is
the only UI that selects a locked object's keyframes, so guarding it closes the reachable
residual — see §3).

## 2. The change is UI-only, in `Timeline.tsx`

The timeline maps full `SceneObject`s, so `obj.locked` is in scope for every row. Three
guards + one class:

- **Each of the 6 keyframe diamonds** (scalar / shape / color / gradient / dash /
  progress): prepend `if (obj.locked) return;` to its `onPointerDown`. This is the single
  chokepoint that blocks BOTH the keyframe select AND the S25 retime drag-start (both run
  in that one handler: `e.stopPropagation()` → `selectX(...)` → `startKeyframeDrag(...)`).
- **The object-row label** `onClick`: guard `() => { if (!obj.locked) selectObject(obj.id); }`
  so clicking a locked row's name does not select the object.
- **The row** gains a `locked` class when `obj.locked` (visual dim).

No store change. The keyframe-select store actions remain unguarded because the timeline
diamonds are their only caller for a locked object (the Stage and Layers panel already
refuse to select locked objects — S19; and `pasteKeyframe`/`retimeSelectedKeyframe` only
re-select keyframes that were already selected, which a locked object's can no longer be).

## 3. Why the timeline guard fully closes the residual

After S19, the selection paths for an object / its keyframes are: (a) the Stage
(pointer-down guard + deselect-on-lock), (b) the Layers panel (row-click guard), and (c)
the **timeline** (object-row click + keyframe-diamond click + the S25 retime drag). (a)
and (b) already refuse locked objects. This slice closes (c). So no path can select or
edit a locked object or its keyframes — the residual is closed.

Guarding the diamond `onPointerDown` (rather than the store's `selectXKeyframe` actions) is
deliberate: the S25 retime drag-start lives in the *same* handler, so a store-level select
guard alone would still let a drag begin on a locked diamond and then retime the
*previously*-selected keyframe. The handler-level `return` blocks select and drag together.

## 4. CSS

Add to `Timeline.module.css`:

```css
.locked { opacity: 0.45; }
```

(Applied to the locked `.row`, dimming the label + lane so a locked track reads as
disabled. The diamonds are made inert by the JS guards, not by CSS `pointer-events` —
which jsdom does not honour, so the JS guards keep the non-interaction unit-testable.)

## 5. Persistence & parity

No engine/store/persistence/render/runtime/export/migration change — this is editor chrome
over the existing `SceneObject.locked` flag (S19). Stays v4. Locked objects still render,
animate, and export exactly as before; only their *timeline interactivity* changes.

## 6. Decisions (delegated to implementer, recorded)

1. **Slice = lock-aware timeline**: a locked object's row + keyframe diamonds are
   non-interactive (no select / no retime drag) and dimmed; closes the S19 residual.
2. **UI-only**, in `Timeline.tsx`: `if (obj.locked) return` in each diamond `onPointerDown`;
   guard the label `onClick`; a `locked` row class. No store change.
3. **JS guards** (not CSS `pointer-events`) for behavioural unit-testability.
4. **Editor-only** — no engine/store/persistence change.
5. **One plan.**

## 7. Deferred (tracked)

- Collapsing/hiding a locked object's timeline lane.
- A lock toggle in the timeline track header (lock lives in the Layers panel, S19).
- Store-level guards on the 6 `selectXKeyframe` actions (defense-in-depth; not reachable
  for locked objects once the timeline is guarded).
- Lock-aware audio-clip lanes (audio clips are not objects; out of scope).

## 8. Testing

- **Timeline unit (`Timeline.test.tsx`):**
  - clicking a locked object's keyframe diamond does NOT select the keyframe
    (`selectedKeyframe` stays null);
  - dragging a locked object's keyframe diamond does NOT retime it (the keyframe's time is
    unchanged after a pointerdown→move→up that would otherwise move it);
  - clicking a locked object's row label does NOT select the object
    (`selectedObjectId` stays null);
  - the locked object's row has the `locked` class.
- **e2e (Playwright):** draw a rect → key rotation at t=0 → lock it via the Layers panel →
  attempt to drag its rotation diamond right by `PX_PER_SECOND` px → the diamond stays at
  t=0 (`keyframe-<id>-rotation-0` still present, no `…-rotation-1`).
