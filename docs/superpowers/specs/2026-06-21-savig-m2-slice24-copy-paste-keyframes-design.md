# M2 Slice 24 — Copy / paste keyframes (design)

Date: 2026-06-21
Status: design approved (decisions delegated to implementer; see §7)
Predecessor: Slice 23 — scale handles (merged `cab2574`)

## 1. Goal

Let a user **copy the selected keyframe and paste it at the playhead** — preserving its
value AND easing — on the same track of the same object. This complements the Slice-21
**object** clipboard: now Cmd/Ctrl+C/V work on a selected *keyframe* too, routed by
priority (keyframe selected → keyframe; else object), the same way the Delete key already
prioritises keyframes over the object.

All six selectable keyframe types are supported: **scalar** transform keyframes (x/y/
scaleX/scaleY/rotation/opacity), **shape** (morph), **color**, **gradient**, **dash**,
and **progress** (motion-path). Pasting clones the keyframe to the snapped playhead time
and selects it.

Non-goals (deferred, §8): cross-object keyframe paste (paste targets the copied
keyframe's own object); cutting a keyframe (Cmd/Ctrl+X is a no-op when a keyframe is
selected for now); pasting multiple keyframes / a time range (M4); the OS clipboard.

## 2. Clipboard state

A new transient store field, a tagged union over the six kinds:

```ts
type KeyframeClip =
  | { kind: 'scalar'; objectId: string; property: AnimatableProperty; keyframe: Keyframe }
  | { kind: 'dash'; objectId: string; keyframe: Keyframe }
  | { kind: 'progress'; objectId: string; keyframe: Keyframe }
  | { kind: 'color'; objectId: string; property: ColorProperty; keyframe: ColorKeyframe }
  | { kind: 'gradient'; objectId: string; property: ColorProperty; keyframe: GradientKeyframe }
  | { kind: 'shape'; objectId: string; keyframe: ShapeKeyframe };

keyframeClipboard: KeyframeClip | null;
```

- **Transient**, declared next to `clipboard` (Slice 21) — **outside** `TRANSIENT_DEFAULTS`,
  so it survives `newProject` (initial `null`).
- **Mutually exclusive with the object `clipboard`:** `copyKeyframe` sets
  `keyframeClipboard` and clears `clipboard`; `copySelected` (Slice 21) sets `clipboard`
  and clears `keyframeClipboard`. So at most one is non-null and Cmd+V is unambiguous.
- Frozen by immutability (the store never mutates a keyframe in place), so the captured
  keyframe reference is a snapshot.

## 3. Store — `copyKeyframe` / `pasteKeyframe`

```ts
copyKeyframe(): void;
pasteKeyframe(): void;
```

**`copyKeyframe`** — find whichever of the six selected refs is set, locate that keyframe
in its track (by `KF_EPS` time match, like `setSelectedKeyframeEasing`), and snapshot it.
No-op if no keyframe is selected.

```ts
copyKeyframe() {
  const s = get();
  const p = s.history.present;
  const find = <K extends { time: number }>(track: K[] | undefined, time: number) =>
    track?.find((k) => Math.abs(k.time - time) < KF_EPS);
  if (s.selectedKeyframe) {
    const r = s.selectedKeyframe;
    const kf = find(p.objects.find((o) => o.id === r.objectId)?.tracks[r.property], r.time);
    if (kf) set({ keyframeClipboard: { kind: 'scalar', objectId: r.objectId, property: r.property, keyframe: kf }, clipboard: null });
    return;
  }
  if (s.selectedShapeKeyframe) {
    const r = s.selectedShapeKeyframe;
    const kf = find(p.objects.find((o) => o.id === r.objectId)?.shapeTrack, r.time);
    if (kf) set({ keyframeClipboard: { kind: 'shape', objectId: r.objectId, keyframe: kf }, clipboard: null });
    return;
  }
  if (s.selectedColorKeyframe) {
    const r = s.selectedColorKeyframe;
    const kf = find(p.objects.find((o) => o.id === r.objectId)?.colorTracks?.[r.property], r.time);
    if (kf) set({ keyframeClipboard: { kind: 'color', objectId: r.objectId, property: r.property, keyframe: kf }, clipboard: null });
    return;
  }
  if (s.selectedGradientKeyframe) {
    const r = s.selectedGradientKeyframe;
    const kf = find(p.objects.find((o) => o.id === r.objectId)?.gradientTracks?.[r.property], r.time);
    if (kf) set({ keyframeClipboard: { kind: 'gradient', objectId: r.objectId, property: r.property, keyframe: kf }, clipboard: null });
    return;
  }
  if (s.selectedDashKeyframe) {
    const r = s.selectedDashKeyframe;
    const kf = find(p.objects.find((o) => o.id === r.objectId)?.dashOffsetTrack, r.time);
    if (kf) set({ keyframeClipboard: { kind: 'dash', objectId: r.objectId, keyframe: kf }, clipboard: null });
    return;
  }
  if (s.selectedProgressKeyframe) {
    const r = s.selectedProgressKeyframe;
    const kf = find(p.objects.find((o) => o.id === r.objectId)?.motionPath?.progress, r.time);
    if (kf) set({ keyframeClipboard: { kind: 'progress', objectId: r.objectId, keyframe: kf }, clipboard: null });
    return;
  }
}
```

**`pasteKeyframe`** — clone the clipboard keyframe to `time = snapToFrame(playhead, fps)`,
upsert it into the same track of the same object (one `commit`), and select it. No-op when
the clipboard is empty or the object is gone (or — for `progress` — the object has no
motion path to attach to). Re-creates an absent track (`?? []`) so a paste still lands if
the source track was emptied since copy.

```ts
pasteKeyframe() {
  const clip = get().keyframeClipboard;
  if (!clip) return;
  const project = get().history.present;
  const obj = project.objects.find((o) => o.id === clip.objectId);
  if (!obj) return;
  const time = snapToFrame(get().time, project.meta.fps);
  switch (clip.kind) {
    case 'scalar': {
      const next = upsertKeyframe(obj.tracks[clip.property] ?? [], { ...clip.keyframe, time });
      get().commit(replaceObject(project, { ...obj, tracks: { ...obj.tracks, [clip.property]: next } }));
      get().selectKeyframe({ objectId: obj.id, property: clip.property, time });
      return;
    }
    case 'dash': {
      const next = upsertKeyframe(obj.dashOffsetTrack ?? [], { ...clip.keyframe, time });
      get().commit(replaceObject(project, { ...obj, dashOffsetTrack: next }));
      get().selectDashKeyframe({ objectId: obj.id, time });
      return;
    }
    case 'progress': {
      if (!obj.motionPath) return;
      const next = upsertKeyframe(obj.motionPath.progress, { ...clip.keyframe, time });
      get().commit(replaceObject(project, { ...obj, motionPath: { ...obj.motionPath, progress: next } }));
      get().selectProgressKeyframe({ objectId: obj.id, time });
      return;
    }
    case 'color': {
      const next = upsertColorKeyframe(obj.colorTracks?.[clip.property] ?? [], { ...clip.keyframe, time });
      get().commit(replaceObject(project, { ...obj, colorTracks: { ...obj.colorTracks, [clip.property]: next } }));
      get().selectColorKeyframe({ objectId: obj.id, property: clip.property, time });
      return;
    }
    case 'gradient': {
      const next = upsertGradientKeyframe(obj.gradientTracks?.[clip.property] ?? [], { ...clip.keyframe, time });
      get().commit(replaceObject(project, { ...obj, gradientTracks: { ...obj.gradientTracks, [clip.property]: next } }));
      get().selectGradientKeyframe({ objectId: obj.id, property: clip.property, time });
      return;
    }
    case 'shape': {
      const next = upsertShapeKeyframe(obj.shapeTrack ?? [], { ...clip.keyframe, time });
      get().commit(replaceObject(project, { ...obj, shapeTrack: next }));
      get().selectShapeKeyframe({ objectId: obj.id, time });
      return;
    }
  }
}
```

`copySelected` (Slice 21) gains `keyframeClipboard: null` in its `set` (mutual exclusion).
`pasteKeyframe` commits unconditionally (it's an explicit paste, not an auto-key edit —
no `autoKey` gate), like `duplicateSelected`.

## 4. Keyboard routing (`useKeyboard.ts`)

Extend the Slice-21 Cmd/Ctrl handlers to prioritise a selected keyframe (mirrors the
Delete chain). A helper boolean:

```ts
const kfSelected = !!(s.selectedKeyframe || s.selectedShapeKeyframe || s.selectedColorKeyframe ||
  s.selectedGradientKeyframe || s.selectedDashKeyframe || s.selectedProgressKeyframe);
```

- **Cmd/Ctrl+C** → `kfSelected ? s.copyKeyframe() : s.copySelected()`.
- **Cmd/Ctrl+V** → `s.keyframeClipboard ? s.pasteKeyframe() : s.paste()`.
- **Cmd/Ctrl+X** → `kfSelected ? /* no-op: cut-keyframe deferred */ : s.cut()`.

All under the existing `isEditable` early-return (native text copy/paste preserved).

## 5. Persistence & parity

No persistence/render/runtime/migration change. The keyframe clipboard is transient.
`pasteKeyframe` upserts a keyframe — the same commit shape the set*/upsert paths already
produce — so it round-trips, animates, and exports normally. Stays v4.

## 6. Edge cases

- **Paste replaces a coincident keyframe:** `upsert*` insert-or-replace by time, so
  pasting onto a time that already has a keyframe on that track overwrites it with the
  pasted value+easing (standard paste semantics).
- **Source track emptied since copy:** `?? []` rebuilds it (paste still lands); except
  `progress`, which needs `obj.motionPath` to exist (else no-op).
- **Object deleted since copy:** `pasteKeyframe` no-ops (object not found).
- **Cmd+X with a keyframe selected:** no-op for now (object is NOT cut — avoids the
  confusing "X cuts the object while a keyframe is selected"); cut-keyframe is deferred.
- **Mutual exclusion:** copying an object clears the keyframe clipboard and vice versa,
  so Cmd+V always pastes the last-copied thing.

## 7. Decisions (delegated to implementer, recorded)

1. **Slice = copy/paste keyframes**, all six selectable types, paste at the snapped playhead.
2. **`keyframeClipboard` tagged union**, transient (survives newProject), mutually exclusive with the object `clipboard`.
3. **`copyKeyframe` / `pasteKeyframe`** store actions (6-branch, mirroring `setSelectedKeyframeEasing`); paste selects the pasted keyframe; no autoKey gate.
4. **Keyboard** Cmd/Ctrl+C/V routed by keyframe-priority; Cmd/Ctrl+X no-ops on a selected keyframe.
5. **Editor-only** — no persistence/render/runtime/migration change.
6. **One plan.**

## 8. Deferred (tracked)

- Cross-object keyframe paste (paste onto a different selected object); paste targets the
  copied keyframe's own object for now.
- Cut a keyframe (Cmd/Ctrl+X copy + delete); currently X no-ops when a keyframe is selected.
- Copy/paste a SELECTION of keyframes / a time range; nudging pasted keyframes.
- OS/system clipboard for keyframes; pasting across documents (the in-app clipboard does
  survive newProject, but cross-object/track targeting is deferred).

## 9. Testing

- **Store unit (`store.test.ts`):**
  - `copyKeyframe` + `pasteKeyframe` round-trips a **scalar** rotation keyframe (with a
    non-linear easing) to a new playhead time: a second keyframe appears at the new time
    with the SAME value and easing; one history entry; the pasted keyframe is selected.
  - same round-trip for a **color** keyframe (value=hex preserved) and a **shape**
    keyframe (path preserved) — covering the structurally-distinct track types.
  - `copyKeyframe` sets `keyframeClipboard` and CLEARS the object `clipboard` (and
    `copySelected` clears `keyframeClipboard`) — mutual exclusion.
  - `pasteKeyframe` is a no-op with an empty clipboard (no history entry) and when the
    source object was deleted.
- **Keyboard unit (`useKeyboard.test.ts`):** with a scalar keyframe selected, Cmd/Ctrl+C
  sets `keyframeClipboard` (NOT the object clipboard); Cmd/Ctrl+V then adds a keyframe at
  the moved playhead. With no keyframe selected, Cmd/Ctrl+C copies the object (Slice-21
  behavior intact).
- **e2e (Playwright):** draw a rect → key rotation at t=0 (rotate handle or Inspector) →
  select that keyframe → Cmd/Ctrl+C → move the playhead → Cmd/Ctrl+V → the rotation track
  now has two keyframes (assert via a second diamond in the rotation lane, or the exported
  transform animating).
