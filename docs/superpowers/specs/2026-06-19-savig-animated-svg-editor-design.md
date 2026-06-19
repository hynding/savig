# Savig — Animated SVG Editor (Milestone 1 Design)

**Date:** 2026-06-19
**Status:** Approved design — ready for implementation planning
**Author:** Steve Hynding (with Claude)

## Summary

Savig is a client-only web application for **creating, importing, animating, and
exporting animated SVGs**, with audio integration on the timeline and export to a
self-contained HTML5 bundle (SVG + CSS3 + JavaScript) with synced audio.

It is inspired by [Wick Editor](https://github.com/Wicklets/wick-editor) but is a
focused subset: an **animation layer over SVG art** rather than a full game/creative
suite. Vector drawing tools are explicitly a later milestone.

### Stack & standards

- **Package manager:** pnpm
- **Framework:** React 18+ with TypeScript (strict)
- **Build:** Vite
- **State:** Zustand
- **Testing:** Vitest (unit/integration) + React Testing Library + one Playwright e2e smoke test. Built test-first (TDD).
- **Styling:** CSS Modules consuming CSS custom-property design tokens (theming first-class; no CSS framework).
- **Zip/asset packing:** `fflate` (tiny) for `.savig` and export bundles.
- **No backend.** Everything runs in the browser.

## Product decisions (locked)

| Decision | Choice |
|----------|--------|
| Editing model | **Hybrid:** import + animate first (M1); drawing tools later |
| Animation model | **Keyframe + tween** (Flash/Wick-style), interpolated with easing |
| HTML5 export | **Self-contained bundle + tiny runtime** that shares the editor's tween core |
| Audio | **Place clips on a track + sync** (Web Audio API) |
| Persistence | **`.savig` file (zip) on disk + IndexedDB autosave**, no accounts |
| Scenes | **Single scene/timeline in M1** (multi-scene is a future milestone) |

---

## 1. Architecture

A client-only SPA with three layers and strict boundaries:

```
┌──────────────────────────────────────────────────────────┐
│  UI layer (React + CSS theming)                            │
│  Stage · Timeline · Inspector · Asset panel · Toolbar      │
├──────────────────────────────────────────────────────────┤
│  Document & engine layer (framework-agnostic TS)           │
│  • Project model (objects, keyframes, audio clips)         │
│  • Tween core  ← SHARED with export runtime                │
│  • Playback clock (time → rendered state)                  │
│  • Commands + undo/redo                                     │
├──────────────────────────────────────────────────────────┤
│  Services layer                                            │
│  • Import (SVG, audio)  • Export (HTML5 bundle)            │
│  • Persistence (.savig zip ⇄ disk, IndexedDB autosave)     │
│  • Audio playback (Web Audio API)                          │
└──────────────────────────────────────────────────────────┘
```

**Key principle:** the engine layer has **zero React/DOM dependencies**. It is pure
TypeScript so it is fast to unit-test under TDD, and the tween core can be lifted
verbatim into the export runtime — guaranteeing **preview == export**.

---

## 2. Data model

The project document is a **plain serializable object** (no behavior baked into the
data; behavior lives in engine functions that operate on it). This makes save/load
and undo trivial and testable.

```ts
Project
  ├─ meta        { name, width, height, fps, duration, durationMode, loop, version }
  ├─ assets[]    SvgAsset | AudioAsset        // imported source, content-addressed
  ├─ objects[]   SceneObject                  // instances placed on the single stage
  └─ audioClips[] AudioClip

SvgAsset
  └─ { id /* content hash */, name, normalizedContent /* id-namespaced SVG */, viewBox, width, height }

AudioAsset
  └─ { id /* content hash */, name, mimeType }   // binary stored separately, not inline

SceneObject
  ├─ id, name, assetId, zOrder, parentId?     // parentId reserved for grouping (future)
  ├─ anchorX, anchorY                         // transform origin/pivot (default: bbox center)
  └─ tracks: { [property]: Keyframe[] }       // x, y, scaleX, scaleY, rotation, opacity

Keyframe
  └─ { time /* seconds */, value, easing, rotationMode? }
      // easing: linear | easeIn | easeOut | easeInOut | cubicBezier(p1,p2,p3,p4)
      // rotationMode (rotation track only): "shortest" (default) | "raw"

AudioClip
  └─ { id, assetId, startTime, inPoint, outPoint, volume }
```

### Model decisions

- **Assets vs objects are separate.** One imported SVG can be instanced multiple
  times. Assets are **content-addressed** (hash) so re-importing the same file dedupes.
- **Binary/source assets are stored separately** from the document tree (Blobs in
  IndexedDB; separate entries in the `.savig` zip). The document references them by id.
  This keeps undo snapshots light (see §7) and avoids base64 bloat.
- **Per-property keyframe tracks** (not per-object snapshots) — matches how animators
  think and keeps tweening independent per property.
- **`anchorX/anchorY`** define the pivot for rotation and scale (default = bbox center).
- **Time is continuous (seconds)** internally; the UI snaps keyframe placement to
  frames derived from `meta.fps` (animators think in frames; the runtime is RAF/continuous).
- **`durationMode`**: `"auto"` (derived from the last keyframe / audio end) or
  `"manual"` (explicit `meta.duration` override). `loop` toggles looping in editor and export.

### SVG id namespacing (critical)

On import, **every internal id is namespaced** (e.g. `a3f2__gradient1`) and **all
`url(#…)` / `xlink:href` references are rewritten**, before the SVG is inlined.
Without this, inlining multiple SVGs into one document silently corrupts gradients,
filters, clip-paths, masks, and `<use>` references. `SvgAsset.normalizedContent`
stores this namespaced form, never the raw file.

### Per-instance coordinate wrapping

Each placed object renders as a `<g>` wrapping the asset's content. The transform is
emitted as a single deterministic attribute string in this **fixed left-to-right
order** (SVG applies them right-to-left to coordinates, so reading the string
right-to-left: scale and rotate happen about the anchor, then the whole thing is
translated into place):

```
transform="translate(x, y) rotate(angle, anchorX, anchorY)
           translate(anchorX, anchorY) scale(scaleX, scaleY) translate(-anchorX, -anchorY)"
```

The `translate(anchor) scale translate(-anchor)` sandwich is what makes scaling pivot
about the anchor (SVG `scale()` has no built-in center). A single `buildTransform()`
helper in the engine produces this string, and **both `Stage` and the exporter call
it** — there is one transform definition shared by preview and output, which keeps them
byte-identical. Each asset's own `viewBox`/size is normalized into this wrapper.

---

## 3. Tween core & playback (shared heart)

```ts
// Pure, dependency-free. Lives in engine/, compiled standalone into the export runtime.
interpolate(track: Keyframe[], time: number): number
sampleObject(obj: SceneObject, time: number): RenderState   // resolved transform + opacity
sampleProject(project: Project, time: number): RenderState[] // everything at time t
```

- **Playback clock:** a single authoritative time value in seconds. The editor's RAF
  loop and the export runtime both advance the clock, call `sampleProject(t)`, and
  apply results to SVG nodes.
- **Easing registry:** a small named registry shared everywhere so `easeInOut` in the
  editor is byte-identical in export.
- **Easing segment semantics (explicit contract):** a keyframe's `easing` governs the
  segment **leaving** it. I.e. the A→B segment uses keyframe **A**'s easing.
- **Rotation interpolation:** `rotationMode` per rotation keyframe — `"shortest"`
  (default; 350°→10° goes +20°) or `"raw"` (interpolate the literal degree values).
- **Edge cases:** a track with no keyframes returns the object's static value; times
  before the first / after the last keyframe **clamp**; an empty project still plays.
- **Testability:** sampling is a pure function `(project, time) → state`, unit-testable
  with no DOM (e.g. "object with keyframes at t=0 x=0 and t=1 x=100 is at x=50 at t=0.5").

### Performance principle (important)

During playback the engine writes sampled values **imperatively to SVG node refs**,
bypassing React reconciliation. React state syncs only on **pause / seek / selection**.
Driving React at 60fps is a non-starter. This is the same technique the export runtime
uses, so the pattern is shared.

---

## 4. Audio playback & sync

- **Web Audio API.** Audio is decoded via `decodeAudioData` and scheduled on the
  `AudioContext`.
- **Master clock during playback:** the **AudioContext clock is master** when audio is
  present and playing (sample-accurate); the visual RAF loop reads
  `audioContext.currentTime` so visuals follow audio. With no audio, the RAF clock is
  master.
- **Autoplay policy:** the first **Play** user gesture resumes/creates the
  `AudioContext` (browsers block audio without a gesture).
- **Scrubbing:** audio does **not** stream while scrubbing the playhead (silent scrub
  in M1). Audio resumes on Play from the playhead position.
- **Clips:** each `AudioClip` schedules its `AudioAsset` at `startTime`, honoring
  `inPoint`/`outPoint` (trim) and `volume`. Multiple clips on the single audio track
  are supported.
- **Lifecycle:** object URLs are revoked and the `AudioContext` is suspended/closed
  appropriately to avoid leaks.

---

## 5. Import & export

### Import

- **SVG:** parse, **sanitize** (strip `<script>`, external references, and any
  embedded SMIL/CSS animation — flattened/ignored in M1), **namespace ids** (§2),
  capture `viewBox`/dimensions, store as `SvgAsset`. `<foreignObject>` is not supported
  in M1 (stripped with a warning).
- **Audio:** validate type/size, store the binary as a Blob (`AudioAsset`); decode
  lazily for playback.
- **Errors:** malformed SVG or unsupported/oversized audio → clear toast; the stage
  never crashes. File types validated up front.

### Export (HTML5 bundle)

`exportHtml(project) → { 'index.html', 'savig-runtime.js', 'assets/...' }`, zipped for
download.

- **index.html:** inline `<svg>` with all objects as real SVG nodes (initial state),
  ids/transforms exactly as the editor renders them.
- **savig-runtime.js:** the **same tween core + clock**, compiled standalone, plus a
  small player (~100 lines) that maps sampled state onto SVG nodes by id and drives
  audio via Web Audio. Includes play/pause/loop per `meta.loop`.
- **Audio embedding (file:// gotcha):** audio is embedded as **base64 → decoded to
  ArrayBuffer → `decodeAudioData`** so the exported bundle works when opened directly
  via `file://` (a plain `fetch()` of audio is blocked under `file://` in many
  browsers). Larger output is the accepted tradeoff for offline-openable exports.
- **Deterministic output:** generated HTML/JS is **byte-stable** — sorted ids, no
  timestamps or randomness — so golden-file export tests don't flake.
- **Missing asset:** export fails with a specific message naming the asset; never emits
  a silently broken bundle.

---

## 6. UI layout & components

```
┌─────────────────────────────────────────────────────────────┐
│  Toolbar:  [New] [Open] [Save]  [Import SVG] [Import Audio]   │
│            [▶ Play] [⏸] [⏮] [⟲ loop]  00:00.0/00:05.0  [Export ▾]│
├──────────────┬──────────────────────────────┬───────────────┤
│  Assets      │                              │  Inspector     │
│  ┌────────┐  │                              │  ┌──────────┐  │
│  │ svg #1 │  │      STAGE (live <svg>)      │  │ x, y     │  │
│  │ svg #2 │  │    selection handles         │  │ scale    │  │
│  │ audio  │  │    zoom / pan                 │  │ rotation │  │
│  └────────┘  │                              │  │ opacity  │  │
│              │                              │  │ anchor   │  │
├──────────────┴──────────────────────────────┴───────────────┤
│  TIMELINE                          [auto-key ⦿]              │
│   ▸ Object 1   ◆────────◆──────◆     (keyframes per track)   │
│   ▸ Object 2        ◆────────◆                               │
│   ♪ Audio      [====clip====]                                │
│   └ playhead ▏ ruler / frame-snapped scrubber               │
└─────────────────────────────────────────────────────────────┘
```

Component boundaries (each independently testable; talks to the store via selectors):

- **`Stage`** — renders objects as SVG; select / drag / transform; **zoom & pan**;
  emits commands. Imperative DOM updates during playback (§3).
- **`Timeline`** — tracks, keyframes, playhead scrubbing (frame-snapped), audio clip
  lane, **auto-key toggle**.
- **`Inspector`** — edits the selected object's properties at the current playhead.
  Behavior governed by **auto-key**: on → editing creates/updates a keyframe at the
  playhead; off → editing is blocked (nearest-keyframe editing reserved for later).
- **`AssetPanel`** — imported SVG/audio list; drag-to-stage to instance.
- **`Toolbar` / `TransportControls`** — file ops, playback, loop, export.

### Keyboard shortcuts (M1)

`Space` play/pause · `←/→` nudge selected object · `,`/`.` step one frame ·
`Del` remove selected keyframe · `⌘Z` / `⇧⌘Z` undo/redo.

### Theming

Design tokens as CSS custom properties (`--color-*`, `--space-*`, `--radius-*`) in
`:root` + `[data-theme="dark"|"light"]`. Component-scoped CSS Modules consume the
tokens. **Dark theme default** (matches creative tools), light theme switchable.

---

## 7. Persistence & undo

- **`.savig` file = a zip** (`fflate`) containing `project.json` + `assets/` (binary
  audio, normalized SVG). Save/open from disk via the File System Access API where
  available, falling back to download/upload.
- **IndexedDB autosave** so work survives refreshes; failures **degrade gracefully**
  (warn, keep working in-memory).
- **Versioning & migration:** `.savig` carries `meta.version`. A **migration registry**
  is scaffolded from `v1` so future format changes can upgrade old files; loading a
  newer/corrupt file shows a recoverable error, not a blank crash.
- **Undo/redo:** snapshot the **document tree only** (binary assets excluded — they are
  immutable and content-addressed, referenced by id), so snapshots stay light.

---

## 8. Error handling & edge cases (summary)

- Imports: malformed/unsupported input → clear toast; stage never crashes; SVG
  sanitized before inlining.
- Persistence: versioned/corrupt `.savig` → recoverable error; autosave failures
  degrade gracefully.
- Engine: empty tracks return static values; out-of-range times clamp; empty project
  plays.
- Audio: AudioContext requires a Play gesture; no audio while scrubbing.
- Export: missing asset → specific failure; output is deterministic.

---

## 9. Testing strategy (TDD)

- **Engine layer (bulk, pure functions), test-first:** interpolation, easing registry,
  segment/rotation semantics, `sampleObject`/`sampleProject`, keyframe CRUD, auto-key
  logic, undo/redo, audio clip timing math, project (de)serialization round-trips.
- **Services:** SVG sanitization & id-namespacing, export bundle structure
  (**golden-file** assertions on deterministic output), `.savig` zip round-trip,
  migration registry.
- **UI:** React Testing Library for behavior (e.g. "editing a property at the playhead
  with auto-key on creates a keyframe"; "drag-to-stage instances an asset").
- **Runtime parity test:** feed the same project + time through editor sampling and the
  export runtime; assert identical output — locks the preview==export guarantee.
- **One Playwright e2e smoke test:** import → keyframe → export → load the exported
  bundle headless → assert it actually animates (catches export regressions unit tests
  can't).
- **Tooling:** `pnpm test` (Vitest), `pnpm lint`, `pnpm typecheck`. Coverage emphasis
  on the engine.

---

## 10. Future milestones (tracked, not built now)

| # | Milestone | Notes |
|---|-----------|-------|
| **M1** | **Import + animate + audio + HTML5 export** | This spec. The foundation. |
| M2 | **Vector drawing tools** | Pen/shapes/brush; integrate a vector lib while keeping SVG as source of truth. The `parentId`/groups and asset model accommodate this. |
| M3 | **Path morphing & advanced tweens** | Interpolate SVG path `d` between keyframes; motion paths, custom-bezier easing UI. |
| M4 | **Grouping, layers & nested symbols/clips** | Reusable animated symbols (Flash-style), layer locking/visibility. |
| M5 | **CSS-only export mode** | Second export target for simple projects (the deferred export option). |
| M6 | **Multitrack audio** | Waveforms, fades, multiple lanes, simple effects. |
| M7 | **Multi-scene projects** | Multiple timelines/scenes (the architecture allows for it). |
| M8 | **Video/GIF export** | Render to frames → encode (ffmpeg.wasm, as Wick does). |
| M9 | **Interactivity / scripting** | Click handlers, simple scripting on objects (games territory). |
| M10 | **Cloud projects & accounts** | Backend, auth, sharing. |
| M11 | **Collaboration / real-time** | Multi-user editing. |

### Deferred polish (the "C" list — follow-up after M1 core)

These were identified during review and intentionally deferred:

- Stage **snapping / alignment guides**.
- A bundled **sample / starter project** for onboarding.
- Export **single-file vs folder** option.
- Project **license** choice (writing fresh — not bound by Wick's GPLv3; MIT is the
  natural default).
