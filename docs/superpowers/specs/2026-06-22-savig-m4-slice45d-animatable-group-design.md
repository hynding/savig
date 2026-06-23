# Savig M4 Slice 45d — Animatable group transform

**Date:** 2026-06-22
**Status:** Approved (autonomous slice cycle — the biggest remaining grouping lift, but small in practice)
**Depends on:** 45a/45b/45c (group containers + compose engine + Layers tree).

## 1. Goal

Let a group's transform be KEYFRAMED, so you can animate a whole group as a unit (move /
scale / rotate the group over time; its children animate with it). Today (45b) a group's
transform is static-base only.

## 2. Why this is small — the architecture already supports it

45a composes the group transform onto its children at COMPUTE time:
`computeFrame(project, time)` prepends `groupTransformPrefix(project, child, time)` to each
child's transform, and `groupTransformPrefix` samples the group **at `time`**
(`sampleObject(group, time)`, which already interpolates tracks). `computeFrame` is the
SHARED frame logic used by the editor `applyFrame` AND the export runtime's per-frame loop
(`src/runtime/index.ts`: `applyFrameToNodes(nodes, computeFrame(project, time))` in rAF). So
a group with transform TRACKS already animates its children — in preview AND export — with
NO group DOM node and NO nested `<g>`. Likewise `computeProjectDuration` already counts
group tracks (extends the auto-duration), and the Timeline already renders every object's
tracks (group rows included).

The ONLY thing enforcing "static" is `applyObjectTransform`, which writes a group's BASE
unconditionally. 45d relaxes that.

**preview==export parity is preserved by construction:** the editor and the exported runtime
call the same `computeFrame`/`groupTransformPrefix` at a given `time`, so an animated group
produces identical child transforms in both — exactly as for any animated object. (The 45b
"static invariant" was an over-conservative assumption, not a parity requirement.)

## 3. The change

`applyObjectTransform(obj, partial, time, autoKey)`:
- a group with `autoKey` ON → upsert keyframes at `time` (animatable, like any object);
- a group with `autoKey` OFF → write `base` (static positioning, the 45b behavior, kept);
- a normal object → upsert keyframes (the caller already gates it on `autoKey`).

The three callers (`setProperties`, `nudgeSelected`, `setObjectsTransforms`) pass `s.autoKey`.
Nothing else changes: the group move-drag and the bbox handles already commit through these
actions, so with auto-key ON, transforming a group at a playhead position writes a keyframe
there; move the playhead and transform again → an animated group. The Timeline shows the
group's keyframe diamonds (existing behavior); the auto-duration extends (existing).

## 4. Scope (YAGNI)

**In:** keyframe a group's transform when auto-key is on; everything downstream
(composition, render, export runtime, Timeline, duration, the 45c visibility cascade) is
unchanged and already correct. Update the 45b "static" comments.

**Out (deferred):**
- **Ungroup of an ANIMATED group bakes the t=0 transform into children and DROPS the group's
  animation** — `bakeGroupIntoChild` samples the group at t=0 (a documented v1 limitation,
  now reachable). Composing two animated transform tracks (group ∘ child) into one is the
  deferred work; for now ungroup an animated group is lossy (a one-line guard could warn, but
  v1 just bakes t=0).
- Per-group-keyframe EASING UI (the Inspector group panel returns before the easing editor —
  group keyframes use linear; retime/select/delete via the Timeline still work).
- Timeline nesting of group rows (the Timeline is flat; group + child rows are siblings).

**No render/export/runtime/Timeline/duration change** — only `applyObjectTransform` + its
three call sites.

## 5. Implementation surface

- `src/ui/store/store.ts`: `applyObjectTransform(obj, partial, time, autoKey)` (group base
  only when `!autoKey`); pass `s.autoKey` at the three call sites. Refresh the 45b "static"
  comments. (`setGroupTransform` — dead, unused since 45b — left as the explicit static-base
  writer; not wired.)

## 6. Testing

- **Store (`store.test.ts`):** with auto-key ON, `setObjectsTransforms([{id: group, x}])` /
  `nudgeSelected` upserts a keyframe on the group's x track at the playhead (not base);
  moving the playhead + transforming again yields TWO keyframes → `sampleObject(group, t)`
  interpolates. With auto-key OFF, the group still writes base (no tracks) — 45b preserved.
- **Frame/parity (`frame.test.ts`):** an animated group (x track 0→100) yields a child whose
  composed `transform` differs at t=0 vs t=1 (the group prefix moved); and the same
  `computeFrame` drives editor and export (parity).
- **Duration (`duration.test.ts`):** a group's keyframe extends the auto-duration.
- **e2e (`animated-group.spec.ts`):** group two rects; with auto-key on, move the group at
  t=0, scrub forward, move it again → two keyframes; scrubbing the playhead moves both
  children together (the group animates). (Optionally: export and assert the bundle's
  runtime animates them — or keep it editor-only and rely on the parity test.)

## 7. Risks

- **Lossy ungroup of an animated group** (bakes t=0, drops animation) — documented; covered
  by a test asserting the t=0 bake + that the group's tracks are gone after ungroup.
- **No new parity surface:** the composition is unchanged; the only new capability is the
  group acquiring tracks, which the shared `computeFrame` already samples identically for
  preview and export. The existing parity test plus a new animated-group frame test guard it.
