# SVG Round-Trip Import — Design Spec

**Date:** 2026-08-14
**Status:** Approved (user-selected recommendation from feasibility analysis)

## Problem

Savig's animated SVG export (`renderAnimatedSvgDocument`) is a lossy one-way artifact: it
samples `computeFrame` into dense SMIL `values` lists, so keyframes, easings, scenes, and
symbol structure are unrecoverable from the file. Separately, "Import SVG" produces a
static-only asset because `sanitizeSvgElement` strips all SMIL, so an animated SVG imports
as a frozen frame. Users cannot open an exported `.svg` and keep editing, and cannot even
*view* a foreign animated SVG.

## Goals

1. **Round-trip (Tier A):** every animated-SVG export embeds the full project (and audio
   binaries) as metadata, and the app's Open flow accepts such a `.svg` exactly like a
   `.savig` — full editability, all features, because it opens the *real* project.
2. **View-only playback:** importing an SVG as an asset keeps *safe* SMIL animation
   elements so the asset plays (as a black box) on the Stage and in exports.
3. **Open a plain SVG:** opening a `.svg` with no embedded project wraps it as a new
   project containing one SVG-asset object (viewable immediately; animated if it has SMIL).

## Non-Goals

- Reconstructing keyframes from metadata-less SMIL samples (Tier B) — not built.
- General foreign-SMIL *editing* semantics (Tier C) — not built.
- CSS-animation relaxation — `@keyframes`/`animation` stripping stays as-is (SMIL only).
- Editor timeline control over asset-internal SMIL (browser runs it on wallclock).

## Design

### 1. Metadata embed (export side)

`renderAnimatedSvgDocument(project, env?, binaries?)` gains an optional `binaries`
parameter (`AssetBinaries`). The emitter always parses the base markup (including the
zero-duration static path, which previously returned the raw string) and inserts, as the
FIRST child of `<svg>`:

```xml
<metadata data-savig-source="project">{"audio":{...},"project":{...}}</metadata>
```

- Payload = `stableJson({ project, audio })` where `audio` maps `assetId -> base64` for
  every `project.audioClips[].assetId` present in `binaries` (empty object otherwise).
- Set via `textContent`, so `XMLSerializer` entity-escapes `<`, `&` — no CDATA, no
  injection surface, decoded transparently by `DOMParser` on read.
- `<metadata>` is a non-rendering SVG element: invisible in `<img>`, browsers, and the
  runtime player; selectors like `[data-savig-object]` match elements only, unaffected.
- Callers: `fileOps.exportAnimatedSvg` passes the editor's `binaries`; the MCP/node path
  passes none (MCP has no audio import).

### 2. Open path (import side)

New `loadProjectOrSvg(bytes): OpenedFile` in `packages/services/src/persistence/`:

```ts
type OpenedFile =
  | { kind: 'project'; file: SavigFile }        // .savig zip OR .svg with embedded project
  | { kind: 'plain-svg'; source: string };      // valid SVG, no savig metadata
```

- Sniff: bytes starting `PK` → `loadSavig` (unchanged path, migrations included).
- Else UTF-8 decode; `DOMParser` as `image/svg+xml`; parsererror / non-`<svg>` root →
  `SavigLoadError`.
- `metadata[data-savig-source="project"]` present → `JSON.parse(textContent)`;
  `migrateProject(payload.project)` (version gate + upgrades apply exactly as for
  `.savig`); base64-decode `payload.audio` into `binaries`.
- Corrupt JSON → `SavigLoadError`; newer version → `UnsupportedVersionError` (propagates).

`fileOps.openProject` accept list becomes `'.savig,.svg'`; `kind: 'project'` →
`setProject` (existing flow); `kind: 'plain-svg'` → `importSvg` + `createProject` sized to
the asset's `width`/`height` + one `createSceneObject` referencing the asset → `setProject`.

### 3. Sanitizer changes (`sanitizeSvgElement`)

a. **Strip `<metadata>`** on asset import (new): prevents a re-imported export from
   inlining a full project JSON blob (bloat) into documents, and keeps embedded project
   data out of asset content entirely.

b. **Keep safe SMIL** (was: remove all of `animate/animateTransform/animateMotion/set/mpath`).
   A SMIL element is REMOVED (with a warning) only when its `attributeName` (trimmed,
   compared case-insensitively) is:
   - `href`, `xlink:href`, or `src` — animating a reference would bypass the `isSafeRef`
     scheme allowlist (e.g. `<set attributeName="href" to="javascript:...">`);
   - `style` — string-valued style injection channel, conservatively blocked;
   - `id` — could defeat `namespaceIds` isolation / collide with editor def ids at runtime;
   - `class` — could latch onto app CSS once inlined into the editor DOM;
   - any `on*` or `data-savig*` name — handler attributes and the editor's own node-lookup
     attributes (`data-savig-object` etc.) must never be animatable by asset content.
   Everything else (geometry, paint values, `transform` via `animateTransform`,
   `animateMotion` + `mpath`) is kept. The existing passes still apply to SMIL elements:
   `on*` attribute strip, and `REF_ATTRS` allowlist (so `mpath href` may only be a
   `#fragment` or data-raster URI).

### Security notes

- Animated *values* (`to`/`from`/`values`) need no scheme check once ref-typed
  `attributeName`s are blocked: they can only set presentation values. `fill`/`stroke`
  `url(...)` values have the same exposure as static content today (pre-existing class,
  unchanged by this feature).
- SMIL `begin`/`end` event syntax (`click`, syncbase) is not script execution; allowed.
- The embedded metadata is inert text; on asset import it is stripped (3a), on open it is
  parsed as JSON only (never innerHTML), and `migrateProject` shape-guards it.
- Export-side bundle re-sanitization (`renderDocument` def inlining) uses the same
  sanitizer, so kept-SMIL assets play in HTML bundle exports too — consistent by
  construction.

### Compatibility

- Existing metadata-less exports (e.g. `apps/react/public/stick-animated.svg`) open via
  the plain-svg wrap path (goal 3) — viewable/playing, not editable. Re-export from source
  to get a round-trippable file.
- `.savig` format, migrations, autosave: untouched. Version gating identical for embedded
  projects.
- Zero-duration exports now pass through DOMParser/XMLSerializer (attribute normalization
  like `data-savig-camera=""`); semantics unchanged (still zero animation elements).
