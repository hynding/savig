# Bitmap import and guides — Design

**Date:** 2026-11-15
**Status:** complete (slices 1–3)

## Goal

Flash/Animate projects lean on raster images every day: painted backgrounds, photo cut-outs,
reference drawings to trace over. SaViG could only hold vectors, imported SVG and text. This
feature adds a **bitmap image object** (PNG, JPEG, GIF, WebP) that behaves like any other drawn
object — move, scale, rotate, keyframe, mask, filter, put in groups and symbols — plus Flash's
**guide** idea: an object (typically a reference image) that is visible and editable in the editor
but never exported.

## Model (engine `types.ts`)

```ts
interface ImageAsset {
  id: string; kind: 'image'; name: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  dataUrl: string;        // data:<mime>;base64,<payload>
  width: number; height: number;  // natural pixel size = the object's local box
}
SceneObject.guide?: boolean;     // editor-only; on a group, the whole subtree
```

- The pixels live **inline** as a base64 `data:` URL. Audio keeps its bytes as separate binaries
  because it is large and only the player needs it; images are needed by every renderer (Stage,
  SVG/HTML/CSS/SMIL export, resvg raster, GIF/video frames, MCP thumbnails), so inlining keeps
  them all working with no binary plumbing and keeps an exported SVG a single self-contained file.
  The editor caps imports (slice 2) so project files stay reasonable.
- An image object is a **box asset** like an imported SVG: absolute anchor (seeded at the box
  centre), the generic transform/opacity tracks, `isBoxAsset()` covers both.
- Format **v12**: the migration only stamps the version (no old file has images); the bump makes
  older builds refuse a file whose images they cannot draw.

## Render (one seam)

`defineSymbol` (shared by Stage `buildDefs` and the exporter) wraps an image asset in the same
identified nested `<svg id="savig-asset-…">` used for SVG assets, holding one
`<image href=… width height preserveAspectRatio="none">`. The body leaf is the existing
`<use href="#savig-asset-…">`, so the runtime, SMIL/CSS samplers, masks, filters, groups and symbol
instances need no image-specific code. resvg rasters embedded PNG/JPEG/GIF/WebP.

## Guides

- `flattenInstances(project, time, { guides: true })` includes guide leaves; the default (every
  export) skips them exactly like hidden objects, so no export draws a guide or emits an orphaned
  def. `computeFrame` always includes them (the editor's painter must reach guide nodes;
  `applyFrameToNodes` skips items with no node, so exports are unaffected).
- The Stage passes `{ guides: true }`; Preview renders the export document, so guides vanish there
  too, which is how Flash's test movie behaves.
- **A guide never masks** (`resolveMaskTarget` ignores it), otherwise the Stage and the export
  would disagree.
- Exports still embed the full project (with guides) in their metadata, so re-importing an
  exported SVG restores the reference image.

## Safety

`sanitizeImages` (load time) accepts only `data:image/(png|jpeg|gif|webp);base64,…`: never a remote
URL (no network fetch on open) and never SVG-in-image (scripts). A bad asset is **repaired** (empty
URL, corrected MIME type, size 1) rather than dropped, so referencing objects keep rendering as an
empty box and nothing dangles. `defineSymbol` re-checks the URL before emitting markup
(defence in depth). A non-`true` `guide` is dropped.

## Slices

1. **Model + render + export** — types, `isBoxAsset`, `isGuideInTree`, flatten option, mask rule,
   `defineSymbol`, renderDocument, Stage defs/bbox/handles/snapping, v12 + sanitizer, tests
   (export structure, runtime, SMIL/CSS, guides in every export, resvg raster, Stage).
2. **Editor** — services `importImage(name, bytes)` (sniffs the type from magic bytes and reads the
   natural size from the file header, no DOM), Asset panel "Import Image" + image rows, drop image files onto the Stage (placed at the
   drop point), size cap with a toast, Inspector Guide checkbox (any object), Layers guide badge,
   `arrange.toggleGuide` command, e2e.
3. **Agent surfaces** — core `addImage` / `setGuide`, DSL `image` object + `guide`, describe,
   validate (unsafe URL error, guide-mask warning), MCP `add_image` (file path or data URL) +
   `set_guide`, a template that uses a bitmap.

## Non-goals (v1)

Trace bitmap (vectorize), bitmap fills for shapes, break-apart / magic wand, image smoothing
toggle, external linked images, animated GIF frame playback (a GIF shows its first frame in
resvg; browsers animate it on their own).
