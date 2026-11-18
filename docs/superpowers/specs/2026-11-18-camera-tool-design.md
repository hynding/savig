# Camera tool — design

Roadmap 9, item 1. Animate has a Camera tool; SaViG's camera (`Project.camera` / `Scene.camera`,
pan + zoom + rotation, keyframes and modifiers) was authorable only from the DSL, core and MCP. The
editor never drew it, not even in preview, so what you saw was not what exported.

## Slice 1 (this PR): see and drive the camera
- **Engine** (`camera.ts`): `cameraViewToWorld` (inverse of `cameraTransform`), `cameraFrameCorners`
  (world corners of what the camera sees), `panCameraBy` (picture moves with the drag),
  `clampCameraZoom` (0.05–20).
- **Store** (`slices/cameraSlice.ts`), acting on the active view's camera (project camera, or the
  selected scene's; never inside a symbol): `addCamera`, `setCameraPose(patch)`,
  `removeCameraKeyframe(axis)`, `removeCamera`. `setCameraPose` keys each axis at the playhead with
  auto-key on; with auto-key off an already-animated axis still takes a key (else the edit is
  invisible) and a still axis edits the static framing. It seeds the camera when there is none.
  Removing an axis's last key leaves the axis still at that key's value. One undo step each.
- **Camera tool** (A, toolbar "Camera"). Choosing it clears the object selection. While it is on
  the Stage draws the scene inside a `[data-savig-camera]` group with the camera transform — the
  same group the exports animate — so the artboard frame is the camera frame. Drag pans (the
  picture follows the pointer), Shift-drag turns it around the frame centre (Shift+Alt snaps to
  15°), the wheel zooms (notches settle into one undo step after 250 ms). The gesture draws live
  from a draft pose and commits the changed axes once on release (`useCameraTool`).
- The group is always rendered (bare when not looking through the camera) so toggling the view
  never remounts the leaves the imperative painter positioned; `applyFrame` also runs the runtime's
  `applyCamera` so playback animates the camera exactly like the exported player.
- **Preview** looks through the camera too (it previously ignored it).
- Other tools: a dashed polygon (`camera-frame`) shows what the camera sees at the playhead.
- **Inspector**: with nothing selected (root or scene), a Camera panel: Add camera; X, Y, Zoom %
  and Rotation fields at the playhead; ◆ marks an axis keyed here (click removes the key), ◇ an
  animated axis; Remove camera.

## Slice 2: camera keys on the timeline, shake and loop
- **Timeline**: a Camera row (`track-row-camera`, above the object rows) whenever the active view
  has a camera, with one rose diamond per key on each animated axis (`camera-keyframe-<axis>-<t>`).
  Pressing a diamond selects it (`selectCameraKeyframe`, which clears the object selection so the
  Inspector shows the Camera panel) and drags it to retime (`retimeSelectedKeyframe`, never onto
  another key of that axis). Delete removes it; Cut does nothing (camera keys have no clipboard).
  Clicking the row label picks the Camera tool. A ∿ badge summarises shake/loop.
- **Camera panel**: with a camera key selected, the easing into it (linear / ease in / out /
  in-out; a custom curve shows as "Custom curve"). "Shake & loop": per axis a Wiggle checkbox
  (defaults: 8 px at 3 Hz for X/Y, 0.03 zoom at 2 Hz, 1.5° at 2 Hz; distinct seeds) with amount and
  frequency fields, and a loop select (no loop / loop / ping-pong). Store `setCameraModifier(axis,
  patch | null)`; adding a shake to a still project switches it to a 2 s manual length (as object
  wiggles do).
- **Engine**: `computeProjectDuration` counts camera keys, so a camera-only push-in plays (it used
  to have zero length unless something else moved).
