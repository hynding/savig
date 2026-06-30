# M5 slice 8b — Multi-scene sequencing (design)

The last open M5 item, and the only slice that restructures the core `Project` model rather than
sitting beside it. Splits the 8b sketch from
`specs/2026-06-28-savig-m5-slice8-scenes-camera-design.md §8b` into a full design.

**Goal:** let a short be a *sequence of scenes* (shots) that play one after another on a single
master timeline, with cuts (and later, fades) between them — the multi-shot story structure a real
animated short needs. Scope is the whole 8b; the work is decomposed into five reviewable sub-slices
(see §16).

---

## 1. What 8b is — and what it is NOT (vs. symbols)

The codebase already has a powerful container abstraction: a **`SymbolAsset` owns its own
`objects[]` scene**, and the editor's **`editPath` active-scene router** scopes every editing action
to the entered scene. It is tempting to model scenes on top of this. That would be a category error:

| | Symbols (existing) | Scenes (8b) |
|---|---|---|
| Composition | **Spatial** — sub-scenes nested *inside* an object, composed **concurrently** at one point on the parent timeline | **Temporal** — top-level shots played **in sequence**, mutually **exclusive** in time |
| Multiplicity at time `t` | Many instances visible at once | Exactly one scene active (two only during a transition) |
| Timeline | Each instance remaps onto the *one* project timeline | Each scene owns a *segment* of the master timeline (`Σ durations`) |
| Reuse | The whole point (one symbol, N instances) | Not a goal — a shot is authored once, played once |

So 8b **reuses the editing infrastructure** (`editPath`, `withSceneObjects`, `activeSceneDims`,
commit/undo gate) but introduces a **new compute/sequencing/export path**. Symbols continue to work
unchanged *inside* any scene.

---

## 2. Governing principle — absent = byte-identical parity

Every M5 slice (camera, text, per-instance timing) followed one discipline: the new capability is an
**optional, default-absent field**, and when absent the project renders byte-for-byte as before. 8b
holds the line:

- `Project.scenes?` is **optional**. **Absent ⇒ single-scene project ⇒ every compute/render/export
  path is byte-identical to today**, including the export parity e2e test and all `.savig` files.
- A single accessor **`projectScenes(project): Scene[]`** is the only place that knows the
  difference. When `scenes` is absent it *synthesizes* one scene from the root:

  ```ts
  function projectScenes(p: Project): Scene[] {
    return p.scenes ?? [{
      id: ROOT_SCENE_ID,                 // stable sentinel, e.g. 'scene-root'
      name: 'Scene 1',
      objects: p.objects,
      duration: computeProjectDuration(p),   // single-scene length (auto or manual)
      camera: p.camera,
    }];
  }
  ```

  Every scene-aware seam (timeline resolution, compute, export, editor) reads scenes **only** through
  this accessor. Nothing else branches on `scenes` presence.

This means: until the user adds a 2nd scene, the field never appears, nothing changes. The migration
that *promotes* a project to multi-scene (§5) only runs when the user/agent explicitly adds a scene.

---

## 3. Data model

```ts
interface Scene {
  id: string;
  name: string;
  objects: SceneObject[];          // the scene's own scene-graph (same type as Project.objects)
  duration: number;                // seconds this scene occupies on the master timeline (manual)
  camera?: Camera;                 // per-scene view transform; absent = identity (parity with 8a)
  transitionIn?: Transition;       // how this scene enters from the previous one (§9); absent = cut
}

type Transition =
  | { kind: 'cut' }                                    // instant (default; 8b-1)
  | { kind: 'crossfade'; duration: number }            // overlap-dissolve (8b-4)
  | { kind: 'dip'; duration: number; color: string };  // dip-to-color, e.g. fade through black (8b-4)

interface Project {
  meta: ProjectMeta;
  assets: Asset[];
  objects: SceneObject[];          // UNCHANGED: the single/root scene when `scenes` is absent
  audioClips: AudioClip[];
  camera?: Camera;                 // UNCHANGED: single-scene camera when `scenes` is absent
  scenes?: Scene[];                // NEW: present ⇒ multi-scene. Ordered = play order.
}
```

### Source-of-truth rule (resolves the dual-state risk)

`Project.objects`/`Project.camera` and `Project.scenes` must never *both* be authoritative:

- **`scenes` absent:** `objects`/`camera` are authoritative (today's behavior).
- **`scenes` present:** `scenes` is authoritative; `objects` is frozen to `[]` and `camera` to
  `undefined` by the promotion migration (§5). The accessor reads `scenes` directly; it never falls
  back to `objects` when `scenes` exists.

`validateProject` enforces this invariant (a non-empty `objects` alongside a present `scenes` is an
Issue), so the rule can't silently rot.

**The synthesized scene (absent case) is a read-only projection.** When `scenes` is absent,
`projectScenes` fabricates one scene whose `duration` = `computeProjectDuration(p)` — which for
`durationMode: 'auto'` is keyframe-derived, *not* a stored manual value. That is fine because the
synthesized scene is never written back; `durationMode` stays on `project.meta` and governs the
single-scene length as today. Only *real* (stored) scenes in `project.scenes` carry an authored manual
`duration` (see "Why `duration` is per-scene and manual" below). No consumer should treat the synthesized scene's `duration` as authoritative state.

### Why `duration` is per-scene and manual

A scene's content (keyframes / symbol-instance internal animation) has a *natural* end
(`computeProjectDuration`-style max), but a shot's on-screen *dwell* is an authoring choice (hold on a
title for 3s even if nothing animates). So `Scene.duration` is an explicit manual value, defaulting on
creation to the scene's natural content length (`max(contentEnd, 1s)`). The editor exposes it; the
content-end is shown as a hint but does not clamp it.

---

## 4. Sequencing & the master timeline

A new pure module `engine/scenes.ts`:

```ts
// Cumulative layout of scenes on the master timeline.
interface SceneSpan { scene: Scene; index: number; start: number; end: number; }
function resolveTimeline(project: Project): SceneSpan[];   // start[i] = Σ duration[0..i-1]

// Total length = max(Σ scene durations − Σ transition overlaps, Σ audioClip ends).
// Audio lives on the MASTER timeline (per-scene audio is deferred, §15), so a clip whose tail
// extends past the last scene still extends the project. Single-scene ⇒ today's value exactly.
function computeProjectDurationMulti(project: Project): number;

// Which scene(s) are on screen at master time t, and the local time within each.
interface SceneSample {
  primary:   { scene: Scene; localTime: number };
  // present only mid-transition (8b-4); primary fades in over outgoing.
  outgoing?: { scene: Scene; localTime: number; progress: number /* 0..1 */ };
}
function sceneAtTime(project: Project, t: number): SceneSample;
```

- `sceneAtTime` accumulates spans, finds the active span, returns `localTime = t - span.start`.
- **Clamping:** `t` past the end pins to the last scene's final frame (matches single-scene clamp).
- Single-scene (`scenes` absent): one span `[0, duration]`, `localTime = t`, no `outgoing` → identical
  to today.

**`computeProjectDuration` becomes a thin dispatcher:** `project.scenes ? computeProjectDurationMulti
: <existing single-scene body>`. The existing body is untouched, so the single-scene number is
byte-identical (important: several tests assert exact durations, and the seek-clamp relies on it).

---

## 5. Persistence & migration (version bump v4 → v5)

`.savig` is a ZIP with `project.json` + binaries; `migrateProject` applies sequential migrations.

- **v5 migration is a no-op shape bump** for existing files: a v4 project has no `scenes` key →
  stays single-scene → parity. We add `5: (doc) => ({ ...doc, meta: { ...doc.meta, version: 5 } })`
  and `CURRENT_VERSION = 5`. **No structural rewrite** — absent `scenes` is already the valid
  single-scene representation.
- **Promotion (runtime, not a file migration):** when the user/agent adds the *second* scene to a
  single-scene project, a pure helper `promoteToMultiScene(project): Project` runs once:

  ```ts
  // root objects/camera/duration become scenes[0]; objects→[], camera→undefined.
  function promoteToMultiScene(p: Project): Project {
    if (p.scenes) return p;                         // already multi-scene
    const scene0: Scene = {
      id: ROOT_SCENE_ID, name: 'Scene 1',
      objects: p.objects, camera: p.camera,
      duration: computeProjectDuration(p),
    };
    return { ...p, objects: [], camera: undefined, scenes: [scene0] };
  }
  ```

  This keeps the source-of-truth rule (§3) intact and is undoable (it goes through the normal commit
  gate in the editor; in `core`/MCP it's a pure transform).

`stableJson` already sorts keys, so save output stays deterministic.

---

## 6. Compute seam — scene-aware `computeFrame` and id namespacing

`computeFrame(project, t)` is the shared preview/export/runtime frame function. It must now produce
the frame for the **active scene** at master time `t`, with **scene-namespaced object ids** so the
runtime node-map keys never collide across scenes.

```ts
function computeFrame(project: Project, t: number): FrameItem[] {
  if (!project.scenes) return computeFrameForScene(project.objects, project.assets, t, null);
  const { primary, outgoing } = sceneAtTime(project, t);
  const items = computeFrameForScene(primary.scene.objects, project.assets,
                                     primary.localTime, primary.scene.id);
  if (outgoing) items.push(...computeFrameForScene(outgoing.scene.objects, project.assets,
                                                   outgoing.localTime, outgoing.scene.id));
  return items;
}
```

- `computeFrameForScene(objects, assets, localTime, sceneId)` is the *current* `computeFrame` body,
  lifted to take an explicit objects-list + the (global) assets instead of reading `project.objects`.
  **No `camera` parameter** — camera is a DOM view-transform applied separately (`applyCamera`, §7),
  never a `FrameItem`; folding it in here would break that architecture. When `sceneId` is non-null it
  **prefixes every `FrameItem.objectId`** with `sceneId + ':'`. (Transition opacity is NOT applied in
  the frame items — the runtime ramps the whole outgoing scene group's opacity, §9; the frame just
  carries both scenes' items so both groups have fresh per-object state.)
- `flattenInstances` reads `project.assets` (global, shared across scenes — symbols/text/svg assets
  are project-wide) and a scene's `objects[]`. Cleanest refactor: extract
  `flattenObjects(objects, assets, time)` as the core, with `flattenInstances(project, t)`
  delegating to it for the root scene. Symbol renderId namespacing inside a scene is unchanged; the
  *scene* prefix is applied once at the `computeFrame` boundary (keeps `flattenInstances` scene-naive).
- **Asset-reference helpers must become scene-aware (C-fix, 8b-1a):** `countSymbolInstances`
  (`engine/symbol.ts`) and `collectReferencedAssetIds` (`engine/removeObject.ts`) currently scan only
  `project.objects` + symbol-internal objects. In multi-scene mode `project.objects` is `[]`, so the
  symbol-delete guard would read 0 (letting you delete a live symbol → dangling refs) and asset-orphan
  pruning would delete assets still used in scenes. Both must additionally iterate
  `project.scenes?.[i].objects`. This is a data-model correctness patch, in 8b-1a.
- **Single-scene (`scenes` absent):** `sceneId` is `null` → **no prefix** → ids byte-identical to
  today. This is the parity hinge for the runtime node map and export `data-savig-object`.

---

## 7. Export / render model — one self-contained file, scenes switched by visibility

**Decision: Model X (inline all scenes, switch by visibility).** Rationale and the rejected
alternative are in §17.

Refactor so the *current* `renderSvgDocument` becomes the **per-scene** renderer, and a thin new
`renderProjectDocument` composes scenes:

```
renderProjectDocument(project):
  if !project.scenes: return renderSvgDocument(project)        // BYTE-IDENTICAL parity path
  for each scene s (in order):
     body_s, defs_s = renderSceneBody(s, project.assets)        // = today's renderSvgDocument internals
     prefix all def ids + data-savig-object ids in (body_s, defs_s) with "<s.id>:"
     wrap body_s in <g data-savig-scene="<s.id>" display="<s===scene0 ? inline : none>">…</g>
  return <svg …><defs>{Σ defs_s}</defs>{Σ wrapped bodies}</svg>
```

- **Id namespacing — prefix per-object/render ids, EXEMPT global asset-keyed defs.** The ids that
  must be scene-prefixed are the ones derived per-object / per-renderId and emitted *per scene*:
  **gradient** ids, **`clipPath`** ids, **tint `filter`** ids, and the **`data-savig-object`** keys
  (plus every internal `url(#id)` / `href="#id"` reference to them — the prefix must be applied at the
  id's *definition and every reference together*, or links break). Implementation: a **per-scene id
  salt** threaded through the existing id builders, never string-rewriting after the fact (rewriting
  risks corrupting user content). The builders (`gradientDefs`, `buildClipPathDefs`, tint filter)
  accept an optional `idPrefix`, default `''` (= parity).

  **EXEMPT (must NOT be prefixed — they are asset-keyed and shared/deduped across all scenes):**
  `savig-asset-*` (SVG-asset `<symbol>`/`<svg>` defs + their `<use href>`) and `savig-sym-*`
  (static-symbol `<use>` optimization defs). These are keyed by `assetId`, not renderId; assets are
  project-global. Prefixing them per scene would duplicate identical defs N times and is pure waste.
  `renderProjectDocument` therefore **collects these asset-keyed defs globally (deduped by assetId)**
  and emits them ONCE in the shared `<defs>` with their unprefixed ids, while per-scene `<defs>`
  fragments carry only the salted gradient/clip/tint ids. (This is the single trickiest part of 8b-2.)
- **Per-scene camera (C-fix):** `computeCameraTransform`/`applyCamera` currently read `project.camera`
  directly, so in multi-scene mode (`project.camera === undefined`) the camera never renders. 8b-1/8b-2
  introduce a camera API that takes an explicit `Camera | undefined`:
  `computeSceneCameraTransform(camera, width, height, t)` and
  `applySceneCamera(sceneGroupEl, camera, t, width, height)`. The single-scene paths keep calling the
  existing `project.camera`-reading functions (parity); the multi-scene export wraps each scene body in
  its own `<g data-savig-camera transform="…">` *inside* that scene's group using the scene's camera
  (absent → no wrapper → parity within the scene).
- **Headless raster path (C-fix, 8b-2):** `core/render.ts` `renderFrameSvg` currently calls
  `renderSvgDocument(project)` (single-scene; renders `project.objects === []` for a multi-scene
  project → blank) and `applyCamera(svg, project, time)` (reads `project.camera`). Since
  `renderFramePng`/`renderThumbnail`/`renderGif`/`renderFrames` and **every MCP visual-feedback
  response** ride on it, 8b-2 MUST update `renderFrameSvg` to call `renderProjectDocument` and apply the
  scene-aware frame: build the node map per `[data-savig-scene]` group, `applyFrameToNodes` +
  `applySceneCamera` for the active scene(s) at their local times, toggle group `display`. Without
  this, all agent rendering of multi-scene projects is blank. (Corrects the §15 GIF note.)
- **viewBox / artboard:** all scenes share the project artboard (`meta.width/height`). A scene with
  different intended dimensions is out of scope (a short has one frame size); the editor keeps all
  scenes at the project artboard.

---

## 8. Runtime — scene switching

`runtime/index.ts` (bundled into `runtimeSource.generated.ts`, regenerated this slice):

- Build the node map per scene group: `[data-savig-scene]` → its `[data-savig-object]` children.
- Each frame at master time `t`: `sceneAtTime` → toggle `display` on scene groups (active +
  transitioning visible, rest `none`), and `applyFrameToNodes` + `applySceneCamera` **only for the
  visible scene(s)** at their local times. Inactive scenes are not recomputed (cheap).
- **Camera query must be scoped per scene (I-fix):** today's `applyCamera` does
  `root.querySelector('[data-savig-camera]')`, which with N scene groups would always grab scene 0's
  camera group. The multi-scene runtime queries the camera group *within the active scene's group*
  (`activeSceneGroup.querySelector('[data-savig-camera]')`) and passes that scene's resolved camera to
  `applySceneCamera`.
- Transitions (8b-4): during overlap, both groups are `display:inline` and the incoming group's root
  opacity ramps `0→1` (crossfade) or a full-frame `color` rect ramps in/out (dip).
- **Single-scene export:** no `[data-savig-scene]` groups exist → the runtime falls back to the
  current whole-SVG node map and single `applyFrame`/`applyCamera` → byte-identical behavior. The
  runtime branches on the presence of scene groups, not on a flag.

`computeProjectDuration(project)` (scene-aware, §4) drives the loop length; `loop`/clamp semantics
unchanged.

---

## 9. Transitions

- **Cut (8b-1):** the default. `transitionIn` absent ⇒ instant switch. `sceneAtTime` returns no
  `outgoing`. `computeProjectDuration` = exact `Σ duration`.
- **Crossfade & dip-to-color (8b-4):** `transitionIn = { kind, duration: d }` on the *incoming*
  scene. During the first `d` seconds of that scene, `sceneAtTime` also returns the previous scene as
  `outgoing` with `progress = localTime / d`. **Master-timeline accounting:** a transition *overlaps*
  — the incoming scene's segment starts `d` before the outgoing scene ends, so
  `computeProjectDurationMulti = Σ duration − Σ transitionOverlap`. `resolveTimeline` accounts for the
  overlap when computing `start[i]`.
  - *Crossfade:* incoming scene group opacity `0→1` over `d`; outgoing stays full → dissolve.
  - *Dip:* outgoing fades to `color` over `d/2`, incoming fades from `color` over `d/2` (a full-frame
    rect at top z). Implemented as a transition overlay rect in the runtime, not per-object.
  - Transition `duration` is clamped to `min(d, prevScene.duration, thisScene.duration)`.

Keeping transitions in their own sub-slice means 8b-1..3 ship the entire sequencing model with cuts
before any dual-scene-render complexity is introduced.

---

## 10. Editor — scene strip + per-scene authoring

Reuse the active-scene routing wholesale:

- **Scene selection = a separate `selectedSceneId`, NOT an `editPath` entry (decision, resolves the
  spec's earlier hedge).** Scene scope and symbol descent are *different axes*: the scene is the
  always-present base shot; `editPath` is optional symbol-nesting *within* the current scene. Reusing
  `editPath` for scenes would break `selectActiveObjects`, which interprets `editPath.at(-1)` as a
  *symbol asset id* (`assets.find(x => x.id === id && x.kind === 'symbol')`) and would silently fall
  through to root on a scene id. So: add `selectedSceneId: string | null` to `EditorState`. The
  active-scene helpers resolve in **two layers** — first the scene base (`selectedSceneId` → that
  scene's `objects[]`, or `project.objects` when single-scene), then the existing `editPath` symbol
  descent on top of that base. Concretely, `selectActiveObjects`/`withSceneObjects`/`activeSceneObjects`/
  `activeSceneDims` gain a "scene base" resolution step; the symbol logic on top is unchanged. **One
  scene is always selected** in multi-scene mode (`selectedSceneId` defaults to `scenes[0].id` on
  promotion/load).
- **Stale-selection clearing on undo (M-fix):** undoing `promoteToMultiScene` (or a scene delete)
  restores a project where `selectedSceneId` may name a scene that no longer exists. The existing
  `clearStaleSelection` (which already nulls stale object/keyframe selections after a history
  restore) must also reset `selectedSceneId` to the first existing scene (or `null` when single-scene).
- **Scene strip** (new UI, a horizontal filmstrip above or beside the Timeline): thumbnails per scene
  (reuse `renderThumbnail` on a scene-scoped project view), **add / delete / reorder (drag) / rename /
  select**, and a per-scene **duration** field + **transition** picker (8b-4). Adding the 2nd scene to
  a single-scene project triggers `promoteToMultiScene` (§5).
- **Timeline** scopes to the active scene (its `localTime` 0..duration), exactly as it already scopes
  to a symbol's internal timeline when editing in-symbol. The transport's master playhead maps to the
  active scene via `sceneAtTime`; scrubbing across a scene boundary selects the new scene.
- **Stage preview** renders the active scene at its local time via the same `computeFrame` path
  (preview == export holds, now per scene).
- Align/distribute/center and all object ops already route through `commitActiveScene` → they operate
  within the selected scene with zero change (the ROOT-scope no-op gate still holds per scene).

---

## 11. DSL (`ShortDoc`) — additive scenes

`core/dsl.ts`:

```ts
interface ShortDoc {
  meta?: {...};
  objects?: ShortObject[];     // single-scene authoring (unchanged; mutually exclusive with `scenes`)
  camera?: {...};              // single-scene camera (unchanged)
  scenes?: ShortScene[];       // NEW: multi-scene authoring
}
interface ShortScene {
  name?: string;
  duration: number;
  objects: ShortObject[];
  camera?: {...};
  transitionIn?: Transition;
}
```

- `compileShort`: if `scenes` present → compile each into a `Scene` (reusing the existing object
  compiler per scene), set `Project.scenes`, leave `objects:[]`. If only `objects` present → today's
  single-scene path (parity). Both present = fail-loud (mutually exclusive).
- `decompileProject`: a multi-scene `Project` → `ShortDoc.scenes`; single-scene → today's
  `ShortDoc.objects`. Round-trip stable for the DSL-authorable subset (no groups/symbols/svg, as
  today).

---

## 12. MCP — agent stays end-to-end driveable

`core` builders (pure, id-addressed) added first, then thin MCP tools over them:

- Core: `addScene(project, { name?, duration?, afterIndex? }) → { project, sceneId }` (auto-promotes),
  `removeScene`, `reorderScene`, `setSceneDuration`, `setSceneTransition`, `setActiveScene` (which
  scene subsequent object builders target — `Session` gains a `currentSceneId`).
- MCP tools: `add_scene`, `remove_scene`, `reorder_scene`, `set_scene_duration`,
  `set_scene_transition`, `list_scenes`, `select_scene`. Existing object tools (`add_rect`, …) write
  into the session's current scene. Mutating tools return `describe` + thumbnail as today; `describe`
  is extended to list scenes + per-scene object counts + durations.
- `Session` holds `{ project, currentSceneId }`; `currentSceneId` defaults to the only/first scene.

---

## 13. Validation

`validateProject` gains scene checks (all fail-loud, as the existing validator):

- `scenes` present **and** `objects` non-empty (source-of-truth violation).
- Empty `scenes` array, or a scene with `duration <= 0`.
- Duplicate scene ids; `transitionIn.duration` exceeding either adjacent scene's duration.
- `transitionIn` set on `scenes[0]` (no previous scene to transition from) — a warning;
  `resolveTimeline` silently ignores it (no overlap before the first scene).
- Existing per-object checks (dangling refs, non-finite, off-artboard, past-duration, single-keyframe,
  symbol-cycle) run **per scene** (iterate `projectScenes`). NB `validate.ts` currently iterates
  `project.objects` directly, which is `[]` in multi-scene mode → it would silently pass everything;
  the per-scene iteration is therefore mandatory in 8b-1a, not optional polish.

---

## 14. Testing strategy

- **Engine (`scenes.ts`):** `resolveTimeline` cumulative spans (incl. transition overlap);
  `sceneAtTime` boundaries, clamp, single-scene identity; `computeProjectDurationMulti` = Σ (minus
  overlaps).
- **Parity (critical):** a single-scene project's `computeFrame`, `renderSvgDocument`,
  `computeProjectDuration`, and `saveSavig` output are **byte-identical** before/after the slice
  (golden-string assertions). This is the gate that proves "absent = parity."
- **Multi-scene compute:** two scenes; assert the right scene's objects appear with prefixed ids at
  times in each segment; boundary cut switches cleanly.
- **Export:** multi-scene SVG has N `[data-savig-scene]` groups, prefixed def ids don't collide
  (construct two scenes that each define a gradient with the same intra-scene id → distinct in output).
- **Migration:** v4 file loads → `scenes` absent → unchanged; `promoteToMultiScene` is idempotent and
  moves root into `scenes[0]`.
- **DSL round-trip:** `compile(decompile(compile(doc)))` stable for a multi-scene doc.
- **Runtime smoke (e2e):** export a 2-scene short, load headless, assert scene 1 visible at t in
  segment 1 and scene 2 at t in segment 2, and that it animates (extends the existing export-animates
  e2e).
- **MCP:** tools mutate `session.project` scenes; `describe` lists them.

---

## 15. Non-goals / deferred

- **Per-scene artboard size** (different frame dimensions per shot) — a short has one frame size.
- **Wipe / slide / custom transitions** beyond cut/crossfade/dip — the transition union is extensible
  later; v1 covers the 3 that 95% of shorts use.
- **Nesting scenes inside scenes / scene reuse in the sequence** — that's the §1-rejected "scene as
  asset" model; symbols already cover spatial reuse.
- **Audio per scene / re-timing audio across scenes** — `audioClips` stay on the master timeline;
  audio-vs-scene-cut alignment is a follow-up.
- **Onion skin across scene boundaries** — the Stage ghosts frames at `localTime ± δ`. Ghosts are
  clamped to **within the active scene** only (no cross-boundary ghosting of the neighbouring shot's
  content); the editor passes the active scene's objects to the onion-skin renderer, so this falls out
  for free. Cross-scene onion skin is explicitly out of scope.

NOT a non-goal (it's in-scope, just clarifying): **GIF / headless raster of a multi-scene sequence
works**, but only because 8b-2 routes `renderFrameSvg` through `renderProjectDocument` (§7, C-fix).
`renderGif` walks the scene-aware `computeProjectDuration` and renders each master-time frame through
that path. It does NOT "just work" off the unchanged single-scene renderer — that was a misread in an
earlier draft; the dependency is now explicit in 8b-2.

---

## 16. Decomposition into sub-slices

Each is an independent reviewable branch with its own `feature-dev:code-reviewer` pass before a
`--no-ff` merge, mirroring the M5 cadence. Parity tests run on every slice.

| # | Sub-slice | Scope | Surface |
|---|-----------|-------|---------|
| **8b-1a** | **Scene model (additive, pure)** | `Project.scenes?`, `Scene`/`Transition` types, `projectScenes` accessor, `engine/scenes.ts` (`resolveTimeline`/`sceneAtTime`/`computeProjectDurationMulti` incl. audio), `computeProjectDuration` dispatcher, scene-aware `countSymbolInstances` + `collectReferencedAssetIds` (C3), migration v5 + committed v4 fixture, `promoteToMultiScene`, per-scene `validate` (I3), **cut only**. No existing function body changes → parity trivial. | headless |
| **8b-1b** | **Scene-aware compute refactor (parity-risky)** | `flattenInstances`→`flattenObjects` extraction, scene-aware `computeFrame` + scene-id prefix on `FrameItem.objectId`. Parity goldens written FIRST (rec. 2). The one slice where single-scene output could drift — kept isolated so the goldens are the whole diff. | headless, parity-gated |
| **8b-2** | **Export + runtime + headless raster** | `renderProjectDocument` with **global asset-keyed def dedup + per-scene gradient/clip/tint id salt (C2)**, `computeSceneCameraTransform`/`applySceneCamera` (C1), `[data-savig-scene]` groups, runtime scene-switching + per-scene camera query (I2), **`core/render.ts` `renderFrameSvg` routed through `renderProjectDocument` (C4)**, **scene-count line in `describeProject` stopgap (I5)**, regenerate runtime bundle. | export/runtime/raster, parity-gated |
| **8b-3** | **Editor** | Scene strip (add/delete/reorder/rename/select/duration), `editPath`/active-scene routing for scenes, per-scene Timeline + master playhead mapping, Stage preview per scene. | UI + e2e |
| **8b-4** | **Transitions** | crossfade + dip-to-color: `sceneAtTime.outgoing`, overlap in `resolveTimeline`/duration, dual-scene compute, runtime overlay, scene-strip transition picker. | engine + runtime + UI |
| **8b-5** | **DSL + MCP** | `ShortDoc.scenes`, `compile`/`decompile`, core scene builders, MCP scene tools, `describe`/`Session.currentSceneId`. | core + mcp |

Recommended order: **8b-1a → 8b-1b → 8b-2 → 8b-3 → 8b-5 → 8b-4** (ship the cut-based sequencing
end-to-end and agent-driveable before the dual-scene transition polish). 8b-5 can run in parallel with
8b-3 (both build on 8b-1/8b-2 and don't touch the same files). The `describeProject` scene-count
stopgap in 8b-2 keeps the MCP workflow non-blind in that window (I5).

---

## 17. Decision summary (trade-offs)

**Data model — `Project.scenes?` (chosen) over scene-as-asset / separate-timeline.** Sequencing is a
top-level concept; modeling scenes as `assets[]` would conflate spatial reuse (symbols) with temporal
exclusivity (scenes), and a separate `timeline[]` indirection is YAGNI (no shot-reuse requirement).
The optional field keeps the absent=parity discipline.

**Export — Model X, inline-all-switch-by-visibility (chosen) over render-each-separately.** Savig's
identity is a single self-contained, scrubbable animated SVG/HTML; X preserves that and makes
transitions trivial (opacity), at the cost of a larger file and per-scene id namespacing. Y (separate
renders sequenced like video) simplifies ids but fragments the export/scrub story and duplicates the
runtime. The id-collision risk in X is the same class deferred in slice-2 (sprite-sheet), but here it
is *solved* with a per-scene id salt threaded through the existing id builders (additive, default
`''` = parity) rather than avoided.

**Transitions — cut-first, fades in a later sub-slice (chosen).** Cut needs only "one active scene at
`t`"; crossfade/dip need simultaneous dual-scene render across both compute and runtime. Shipping the
full sequencing model with cuts before that complexity de-risks the milestone and keeps each merge
small.

**Camera — per-scene (chosen, additive).** Each shot wants its own Ken-Burns; `Scene.camera?` reuses
8a's machinery with the same absent=identity parity, and `project.camera` remains the single-scene
fallback.

**Migration — version bump as no-op + runtime promotion (chosen) over eager wrap-into-scene.** Eagerly
wrapping every existing project into `scenes:[{…}]` on load would break parity (single-scene files
would start traversing the multi-scene path and re-serialize differently). Keeping `scenes` absent
until the user adds a 2nd scene preserves byte-identical behavior for the overwhelming common case.

---

## 18. Post-review resolution + additional recommendations

A `feature-dev:code-reviewer` pass over the first draft (against live `HEAD`) found **4 Critical, 5
Important, 5 Minor** gaps, **all verified against source and resolved inline** in the sections above:

| Finding | Resolved in |
|---------|-------------|
| C1 per-scene camera (`computeCameraTransform`/`applyCamera` read `project.camera`) | §7 (`computeSceneCameraTransform`/`applySceneCamera`), §8 (scoped query, I2), §16 8b-2 |
| C2 global asset-keyed defs (`savig-asset-*`/`savig-sym-*`) must be exempt from scene id-prefix | §7 (exempt + global dedup), §16 8b-2 |
| C3 `countSymbolInstances` / `collectReferencedAssetIds` read empty `project.objects` | §6, §16 8b-1a |
| C4 headless `core/render.ts` renders single-scene → blank for multi-scene | §7, §15 (GIF note corrected), §16 8b-2 |
| I1 duration omits audio · I3 `validate` per-scene · I4 `selectedSceneId` decision · I5 `describe` blind | §4, §13, §10, §16 8b-2 stopgap |
| M1 drop camera from `computeFrameForScene` · M2 onion-skin · M3 undo-stale selection · M4 synthesized duration · M5 `transitionIn` on `scenes[0]` | §6, §15, §10, §3, §13 |

### Additional recommendations (beyond the review — improvements to the plan)

1. **Split 8b-1 into 8b-1a (model, pure) + 8b-1b (compute refactor).** As specced, 8b-1 bundles the
   low-risk model/timeline work with the parity-*risky* `computeFrame`→`flattenObjects` extraction +
   scene-id prefixing. Recommend two branches: **8b-1a** = `Scene`/`Transition` types, `projectScenes`,
   `engine/scenes.ts`, the `computeProjectDuration` dispatcher, migration v5, `promoteToMultiScene`,
   per-scene validate, asset-helper fixes (all *additive*, parity trivially holds because no existing
   function body changes); **8b-1b** = the `flattenInstances`/`computeFrame` internal refactor + prefix
   (the one place single-scene output *could* drift). Isolating 1b makes the parity goldens the entire
   diff's job and keeps the risky review small.

2. **Write the parity goldens and the cross-scene id-collision test FIRST (TDD), before touching the
   renderer.** The two highest-risk invariants are "single-scene output is byte-identical" and "two
   scenes that each define a same-named gradient/clip don't collide." Lock both as failing-then-passing
   tests at the start of 8b-1b / 8b-2 respectively — they are the slices' actual acceptance criteria.

3. **Commit a real v4 `.savig` fixture and assert load→save round-trips byte-identically post-v5.** The
   migration is claimed to be a no-op; prove it with a checked-in fixture, not a synthetic in-memory
   project. This is the regression guard for every future migration too.

4. **Treat the runtime-bundle regen (8b-2) as the one gated, last step.** Per the project's own
   pattern, the runtime bundle is the single generated artifact; regenerate it only once 8b-2's logic
   is green, and diff `runtimeSource.generated.ts` deliberately (size + the scene-switch/camera-scope
   changes) rather than letting it churn mid-slice.

5. **Keep `describeProject` token-compact for multi-scene.** The agent reads `describe` after every MCP
   edit; a naive per-scene object dump balloons tokens. Recommend a one-line-per-scene summary
   (`Scene "Intro" (2.0s, 4 objs)`) with object detail only for the *current* scene (`Session.currentSceneId`).

6. **`ROOT_SCENE_ID` is a fixed sentinel — note the export-id shift on promotion.** After promotion,
   scene 0's exported object ids become `scene-root:<id>`-prefixed. That only affects *new* exports of a
   now-multi-scene project (never an existing single-scene file, which stays unprefixed), so it's
   benign — but call it out so no one mistakes the prefix for a parity break.

7. **Audio-vs-scene-cut is deferred (§15) but flag the seam now:** `audioClips` already extend
   `computeProjectDurationMulti` (I1). The *visual* cut and the *audio* timeline are independent in v1 —
   acceptable, but the editor scene strip should show the master-timeline audio lane unchanged so the
   author can see where cuts land relative to audio, even before per-scene audio exists.
