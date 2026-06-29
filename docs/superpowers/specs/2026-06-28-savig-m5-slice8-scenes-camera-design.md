# M5 slice 8 — Scenes + Camera (design)

The last M5 slice, and the only one that changes the core model rather than sitting beside it.
Split into **8a Camera** (additive; do first) and **8b Scenes/sequencing** (the model redesign;
deferred to its own pass). Rationale: shorts need *movement of the viewport* (Ken-Burns push-ins,
pans, follows) far more often than *multi-shot cuts*, and the camera can be done additively with the
same "absent = identity = parity" discipline every other M5 slice used; multi-scene sequencing
genuinely restructures `Project`.

## 8a — Camera (additive, this sub-slice)

### Model
`Project.camera?: { tracks: Partial<Record<'x'|'y'|'zoom'|'rotation', Keyframe[]>>; base: { x; y; zoom; rotation } }`
— ABSENT = no camera = byte-identical parity (existing projects + the parity test unchanged). The
camera *pose* is "what the camera looks at": `(x, y)` = the artboard point centred in frame, `zoom`
= magnification, `rotation` = roll (deg). Default pose = artboard centre, zoom 1, rot 0 → identity.

Reuses the existing keyframe machinery (`Keyframe[]` per axis, `samplePose` like `sampleObject`),
so easing/keyframe-ops come free.

### View transform (the math)
`computeCameraTransform(project, t): string | null` — `null` when `project.camera` is absent.
Else sample the pose at `t` and emit the SVG transform that puts world point `(x,y)` at the artboard
centre `(W/2, H/2)` at `zoom`/`rotation`:

```
translate(W/2, H/2) · scale(zoom) · rotate(rotation) · translate(-x, -y)
```

Default pose → identity string (so even a present-but-default camera renders identically).

### Render wiring (the invasive part — three consumers, all gated)
The camera wraps the whole scene, so each render path wraps its body in one camera group:
- **Export** (`renderSvgDocument`): wrap the body in `<g data-savig-camera transform="{computeCameraTransform(project,0)}">…</g>` (only when a camera exists). The runtime animates it.
- **Runtime** (`runtime/frame.ts` → regenerate `runtimeSource.generated.ts`): each frame, in addition to `applyFrameToNodes`, set the `[data-savig-camera]` group's transform = `computeCameraTransform(project, t)`. This is the one slice that regenerates the runtime bundle.
- **Editor** (`Stage.tsx`): apply the camera transform to the content group via the existing `applyFrame` path (compute it alongside the per-object frame). preview==export holds.

`flattenInstances` and per-object `computeFrame` are UNCHANGED — the camera is a view wrapper, not an object transform. Persistence: `camera` is just JSON on `Project`; no migration needed (absent on old files).

### Agent API
- core: `setCamera(project, pose)` (static), `setCameraKeyframe(project, {axis, time, value, easing})`.
- macros: `panTo`, `zoomTo`, `kenBurns(from,to)` (a slow push-in/pan).
- DSL: optional `camera` field on `ShortDoc` (base + animate). compile/decompile.
- MCP: `set_camera` tool.

### Tests / gates
Pure: `computeCameraTransform` math (identity default, push-in centring), core/DSL/macros. Render:
`renderFrameSvg` shows the camera `<g>` and the framed content moves with time. **Full e2e** (editor
render path touched) + the export parity test (no camera → unchanged). Regenerate + commit the
runtime bundle.

## 8b — Scenes / sequencing (deferred, the model redesign)

The genuinely invasive part. Sketch (for the follow-up spec):
- `Project.scenes?: Scene[]` where `Scene = { id; name; objects: SceneObject[]; duration }`, with the
  current top-level `objects` becoming scene 0 (migration: wrap into one scene, version bump).
- A timeline that plays scenes in sequence; `computeProjectDuration` = Σ scene durations; the active
  scene at `t` is found by accumulation; `flattenInstances`/`computeFrame` run on the active scene.
- Export: concatenate scenes (the runtime switches scenes by time), or render each + sequence.
- Editor: a scene strip (add/reorder/select), per-scene timeline, transitions (cut/fade) between.
- Ripples through compute/render/export/persistence/editor/Timeline — a multi-slice effort of its own,
  best specced separately once 8a lands.

## Decision summary
Do **8a (camera)** now — additive, parity-safe, high value for shorts, gated by e2e + the parity test
+ a runtime-bundle regen. Defer **8b (multi-scene)** to a dedicated spec/slice, since it restructures
`Project` and the editor's whole timeline model.
