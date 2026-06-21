# M2 Slice 13 — Onion Skinning (design)

Date: 2026-06-21
Status: design approved (decisions delegated to implementer; see §9)
Predecessor: Slice 12 — on-canvas rotation handle (merged `b975441`)

## 1. Goal

Show translucent **ghost** copies of the selected object at its neighboring
keyframe times, so the user can see the motion arc while editing a single frame —
the classic "onion skinning" of every animation tool. Savig has rich animation
authoring (transform/morph/color/gradient/dash/motion) but no way to *see* the
motion except by scrubbing; onion skinning fills that gap.

Non-goals (deferred, tracked in §10): onion skin for **all** objects (v1 is the
selected object only); configurable ghost count / opacity; gradient/dash fidelity
on ghosts (tint silhouette only); auto-hiding ghosts during playback.

## 2. Key property: editor-only chrome, zero pipeline change

Ghosts **reuse `sampleObject`** to render the object at offset times and are pure
editor chrome: never exported, never registered in the playback `nodes` map, not
part of `computeFrame`/the runtime. Therefore:

- **no** change to engine render / runtime / export / persistence,
- **no** migration (project stays v4), **no** bundle regen,
- only a **pure helper** + a **store flag** + a **Stage overlay** + a **toggle**.

## 3. Pure helpers (new `src/engine/onionSkin.ts`)

```ts
/** The sorted, de-duplicated union of every keyframe time on the object, across
 *  ALL track sources: tracks[*], shapeTrack, colorTracks[*], gradientTracks[*],
 *  dashOffsetTrack, motionPath.progress. A static object returns []. */
export function objectKeyframeTimes(obj: SceneObject): number[];

/** The `count` keyframe times immediately before and after the playhead, excluding
 *  any within `eps` of the playhead (that is the live frame). `before` is ordered
 *  nearest-first (descending time); `after` nearest-first (ascending time), so the
 *  caller can ramp opacity by index. */
export function onionSkinTimes(
  times: number[],
  playhead: number,
  count: number,
  eps?: number, // default 1e-6
): { before: number[]; after: number[] };
```

`objectKeyframeTimes` walks each source:
- `Object.values(obj.tracks)` → each `Keyframe[]`
- `obj.shapeTrack`
- `Object.values(obj.colorTracks ?? {})`
- `Object.values(obj.gradientTracks ?? {})`
- `obj.dashOffsetTrack`
- `obj.motionPath?.progress`

collects every `.time`, de-dupes (within `eps`), and returns ascending.

`onionSkinTimes`: partition `times` into `< playhead - eps` and `> playhead + eps`;
`before` = the `count` largest of the first set, ordered descending (nearest first);
`after` = the `count` smallest of the second set, ascending (nearest first).

Pure, framework-free, fully unit-tested.

## 4. Store

A transient UI flag (NOT in undo history), mirroring `autoKey`:

```ts
onionSkin: boolean;          // initial false
toggleOnionSkin(): void;     // flips it
```

## 5. Stage overlay (`Stage.tsx`)

When `onionSkin` is on AND a vector object is selected AND
`onionSkinTimes(objectKeyframeTimes(obj), time, ONION_COUNT)` yields **at least one**
ghost (`ONION_COUNT = 2`), render a `<g data-testid="onion-skins"
pointer-events="none">` **before** the live object map (so ghosts sit under the live
shapes). A static object (no keyframes → no ghosts) renders no group. It contains one
ghost per onion time.

Each ghost (a small local render helper) is the object's shape sampled at the ghost
time. The transform uses the SAME anchor resolution as the live render — for a path,
`resolveAnchor` takes `pathBounds(path)`:

```ts
const gs = sampleObject(obj, ghostTime);
if (asset.shapeType === 'path') {
  const path = gs.path ?? asset.path ?? { nodes: [], closed: false };
  const anchor = resolveAnchor(obj, gs, 'path', pathBounds(path));
  const transform = buildTransform(gs, anchor.anchorX, anchor.anchorY);
  const d = pathToD(path);            // -> <path d={d} .../>
} else {
  const geomAttrs = geometryToSvgAttrs(asset.shapeType, gs.geometry ?? {});
  const anchor = resolveAnchor(obj, gs, asset.shapeType);
  const transform = buildTransform(gs, anchor.anchorX, anchor.anchorY);
  // -> <rect|ellipse {...geomAttrs} .../>
}
```

rendered as:
```tsx
<g transform={transform} opacity={rampOpacity(index)}>
  <ShapeTag {...geomAttrs OR d} fill={tint} fillOpacity={0.18} stroke={tint} strokeWidth={1.5 / zoom} />
</g>
```
where `tint` = `var(--onion-before)` for `before` ghosts, `var(--onion-after)` for
`after` ghosts (the classic past/future convention), and `rampOpacity(index)` fades
with distance (e.g. nearest `0.55`, next `0.3`). Both a faint **fill** and a tint
**stroke** are emitted so closed shapes read as translucent ghosts and open paths
read as outlines. Ghost testid: `onion-ghost-<before|after>-<index>`.

> Ghosts are NOT registered (`register(o.id)` is for the live object only) and carry
> `pointer-events: none`, so they never interfere with selection or drags.

## 6. Toggle UI

- **Timeline** (`Timeline.tsx`): an "Onion" toggle button in the header beside
  "Auto-key" (`aria-pressed={onionSkin}`, `onClick={toggleOnionSkin}`).
- **Keyboard** (`useKeyboard.ts`): `o`/`O` → `toggleOnionSkin()` (free key).
- **Tokens** (`tokens.css`): `--onion-before` (cool, e.g. `#5b8def`) + `--onion-after`
  (warm, e.g. `#ef6a5b`) in both theme blocks.

## 7. Persistence & parity

No persistence/render/runtime/export change (onion skin is a transient editor flag).
The new pure helpers get unit tests (§8); the wiring gets Stage + e2e coverage.

## 8. Testing

- **Engine unit (`onionSkin.test.ts`):**
  - `objectKeyframeTimes`: unions across tracks + shapeTrack + colorTracks +
    gradientTracks + dashOffsetTrack + motionPath.progress; de-dupes; sorted; `[]`
    for a static object.
  - `onionSkinTimes`: picks the right `count` before/after; excludes the on-playhead
    keyframe (within eps); nearest-first ordering; fewer-than-count near the ends.
- **Stage unit (`Stage.test.tsx`):**
  - with `onionSkin` off → no `onion-skins` group;
  - animate an object (x keyframes at 0 and 2), select it, seek to 1, toggle onion on
    → renders `onion-ghost-before-0` and `onion-ghost-after-0`;
  - a static (no-keyframe) selected object → no `onion-skins` group at all (zero ghosts).
- **e2e (Playwright, real chromium):** draw a rect → keyframe x at two times → toggle
  Onion on → seek between the keyframes → assert at least one `onion-ghost-*` element
  is present in the Stage.

## 9. Decisions (delegated to implementer, recorded)

1. **Slice = onion skinning** (marquee animation-editor feature; editor-only; reuses sampling).
2. **Selected object only**, ghosts at its keyframe times, `N=2` before/after the playhead.
3. **Keyframe times = union across all six track sources**; static object → no ghosts.
4. **Tint silhouette** (past/future colors), distance-based opacity, fill+stroke, pointer-events none, under the live objects.
5. **Toggle** = store `onionSkin` + Timeline button + `o` shortcut; off by default.
6. **One plan** — pure helper + store + Stage overlay + Timeline + keyboard + e2e.

## 10. Deferred (tracked)

- Onion skin for **all animated objects** (not just the selected one).
- Configurable ghost **count** + opacity; per-frame (fixed-step) mode in addition to keyframe mode.
- Full-fidelity ghosts (gradient/dash/actual paint) instead of a tint silhouette.
- Auto-hide ghosts during playback; onion only within a time window.
- Boolean ops; multi-select / grouping (M4).
