# M2 Slice 25 — Drag a keyframe in the timeline to retime it (design)

Date: 2026-06-21
Status: design approved (decisions delegated to implementer; see §7)
Predecessor: Slice 24 — copy/paste keyframes (merged `6100d6a`)

## 1. Goal

Let a user **drag a keyframe diamond horizontally in the timeline to change its time** —
the core "retime" gesture every animation tool has. Today keyframes can be created,
selected, deleted, and copy/pasted (S24), but the only way to move one is copy-paste-
delete. Direct drag is the fluid, expected interaction.

All six diamond types are draggable (scalar transform, shape, color, gradient, dash,
progress), so every keyframe in the timeline can be retimed. Dragging snaps to frames;
the keyframe's value/easing are preserved; a pure click (no drag) still just selects.

Non-goals (deferred, §8): vertical drag (changing track/property); dragging a multi-
selection or a time range; drag-to-duplicate (Alt-drag); ripple/retiming neighbours;
constrained drag between neighbours (a retime may cross/overwrite a neighbour).

## 2. Store — `retimeSelectedKeyframe(newTime)`

A single action that retimes whichever keyframe is currently selected (6-branch, the same
shape as `setSelectedKeyframeEasing` / `copyKeyframe`):

```ts
retimeSelectedKeyframe(newTime: number): void;
```

For the selected keyframe: clamp+snap `t = max(0, snapToFrame(newTime, fps))`; if the
keyframe is unresolvable or `t` equals its current time, no-op; otherwise remove it from
its track and `upsert*` a clone at `t` (one `commit`), then re-select it at `t`.

```ts
retimeSelectedKeyframe(newTime) {
  const s = get();
  const project = s.history.present;
  const t = Math.max(0, snapToFrame(newTime, project.meta.fps));
  const find = <K extends { time: number }>(track: K[] | undefined, time: number) =>
    track?.find((k) => Math.abs(k.time - time) < KF_EPS);
  if (s.selectedKeyframe) {
    const r = s.selectedKeyframe;
    const obj = project.objects.find((o) => o.id === r.objectId);
    const track = obj && obj.tracks[r.property];
    const kf = find(track, r.time);
    if (!obj || !track || !kf || Math.abs(t - r.time) < KF_EPS) return;
    const next = upsertKeyframe(track.filter((k) => k !== kf), { ...kf, time: t });
    get().commit(replaceObject(project, { ...obj, tracks: { ...obj.tracks, [r.property]: next } }));
    get().selectKeyframe({ objectId: obj.id, property: r.property, time: t });
    return;
  }
  // …shape (shapeTrack/upsertShapeKeyframe/selectShapeKeyframe),
  //   color (colorTracks[prop]/upsertColorKeyframe/selectColorKeyframe),
  //   gradient (gradientTracks[prop]/upsertGradientKeyframe/selectGradientKeyframe),
  //   dash (dashOffsetTrack/upsertKeyframe/selectDashKeyframe),
  //   progress (motionPath.progress/upsertKeyframe/selectProgressKeyframe — no-op if no motionPath)
  //   — each identical in shape to the scalar branch.
}
```

`upsertKeyframe(track.filter(k => k !== kf), {...kf, time: t})` removes the dragged
keyframe by reference and re-inserts a clone at `t` (sorted). If `t` lands on an existing
neighbour, `upsert*` replaces it (the dragged keyframe wins) — acceptable retime-onto-
existing semantics. The re-select keeps the dragged diamond highlighted at its new time.

## 3. Timeline — the drag (`Timeline.tsx`)

Each diamond already has `onPointerDown` that selects the keyframe. Extend it to also
**start a drag**, and add window listeners that preview and commit:

- A `dragRef = useRef<{ startTime: number; startX: number; el: HTMLElement } | null>(null)`.
- In each diamond's `onPointerDown` (after the existing `selectX(...)`): call
  `startKeyframeDrag(e, kf.time)` which sets `dragRef.current = { startTime: kf.time,
  startX: e.clientX, el: e.currentTarget }` and `e.currentTarget.setPointerCapture?.(e.pointerId)`.
- A `useEffect(() => { window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); return () => { … } }, [])`:
  - **onMove:** if `dragRef.current`, compute `t = Math.max(0, snapToFrame(d.startTime +
    xToTime(e.clientX - d.startX), fps))` and set `d.el.style.left = `${timeToX(t)}px`` —
    an imperative, frame-snapped preview (no re-render until commit).
  - **onUp:** if `dragRef.current`, compute the same `t`; if `t !== d.startTime` call
    `retimeSelectedKeyframe(t)`; clear `dragRef.current = null`.

A pure click (pointer-down then up with no movement) selects but does not retime (`t ===
startTime` → the `onUp` guard skips the commit). The diamond's existing `e.stopPropagation()`
stays (so a diamond click doesn't also seek the ruler).

`fps`, `snapToFrame`, `xToTime`, `timeToX` are already imported/selected in `Timeline.tsx`;
add `useEffect`/`useRef` from React.

## 4. Persistence & parity

No engine/render/runtime/export/migration change. A keyframe's `time` already persists,
animates, and exports; retime is an ordinary `commit`. Stays v4. (`computeProjectDuration`
already folds in keyframe times, so dragging a keyframe later/earlier updates the timeline
duration automatically.)

## 5. Edge cases

- **No movement → select only** (the `t === startTime` guard skips the commit).
- **Drag before t=0** clamps to 0.
- **Retime onto an existing keyframe** on the same track overwrites it (`upsert*` replace).
- **Drag a keyframe of a hidden/locked object:** the timeline still lists those objects'
  lanes (S17 — render-only), so their diamonds are draggable. This is consistent with the
  timeline already allowing keyframe selection on those objects; retime is a timeline edit,
  not a stage edit. (Locked-object keyframe editing via the timeline is the known S19
  residual — out of scope here.)
- **Preview vs commit:** the imperative preview moves the diamond smoothly to snapped
  frames; the commit re-renders it at the same place — no visual jump.

## 6. Decisions (delegated to implementer, recorded)

1. **Slice = drag a keyframe horizontally to retime it**, all six diamond types, frame-snapped.
2. **`retimeSelectedKeyframe(newTime)`** store action (6-branch, mirrors `copyKeyframe`):
   remove-by-reference + `upsert*` at the snapped/clamped time; re-select; no-op if unchanged.
3. **Timeline drag** via the existing diamond `onPointerDown` + window move/up; imperative
   frame-snapped preview; commit on a moved pointer-up; a pure click still just selects.
4. **Editor-only** — no engine/render/runtime/export/migration change.
5. **One plan.**

## 7. Deferred (tracked)

- Vertical drag to change a keyframe's track/property; drag a keyframe between objects.
- Drag a selection / a time range of keyframes; ripple retime; Alt-drag to duplicate.
- Constrained drag (don't cross/overwrite neighbours); a "snap to other keyframes" guide.
- Retiming a locked object's keyframes via the timeline (the S19 lock residual).

## 8. Testing

- **Store unit (`store.test.ts`):**
  - `retimeSelectedKeyframe` moves a **scalar** keyframe to a new time: the old time is
    gone, the new time present with the SAME value and easing; one history entry; the
    keyframe stays selected at the new time.
  - same for a **color** and a **shape** keyframe (structural variety).
  - clamps a negative target to 0; is a no-op (no history entry) when the target equals the
    current time.
- **Timeline unit (`Timeline.test.tsx`):** with a scalar `x` keyframe at t=1, `pointerDown`
  its diamond at `clientX = 1*PX_PER_SECOND`, `pointerMove` the window to `2*PX_PER_SECOND`,
  `pointerUp` → the object's `x` track now has a keyframe at t=2 (and none at t=1).
- **e2e (Playwright):** draw a rect → key rotation at t=0 (Inspector) → drag its rotation
  diamond right by `PX_PER_SECOND` px → the diamond `keyframe-<id>-rotation-1` exists and
  `…-rotation-0` is gone.
