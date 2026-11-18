# Trace Bitmap (roadmap 9, item 3)

Turn an imported picture into filled vector shapes, one per color (Animate's Modify › Bitmap ›
Trace Bitmap).

## Engine (slice 1) — `packages/engine/src/geom/trace.ts`
`traceBitmap(raster, options) → TracedRegion[]` is pure: the caller supplies decoded RGBA pixels.
1. **Quantize**: k-means in RGB on opaque pixels (alpha ≥ `alphaThreshold`, default 128), trained on
   an even-stride sample of ≤ 24k pixels, farthest-point seeding from the mean color (deterministic).
2. **Speckle cleanup**: 4-connected components under `minArea` pixels (default 8) take their
   commonest neighbor's label (transparent counts, so specks on an empty background vanish).
3. **Boundary loops**: crack edges per color with the inside on the right; at diagonal touches the
   walk prefers right turns. Holes come out as their own loops.
4. **Polygon**: staircase runs of length 1 become midpoints (diagonals), longer runs keep corners.
5. **Fit**: closed Douglas–Peucker (`curveFit` pixels 0 / tight 0.6 / normal 1.0 / smooth 1.8 px),
   then Catmull–Rom handles at vertices turning less than the `corners` angle (many 35° /
   normal 60° / few 95°). `pixels` keeps straight segments.
6. Each color is one region: first loop as `path`, the rest as `compoundRings` (evenodd), so
   islands and holes nest correctly. Regions come largest first.
`pixelSize` scales output when a downscaled copy was traced.

`applyTrace(objects, assets, imageObjectId, regions)` replaces the image object with a group that
**keeps its id** (masks, parents and selections that point at it keep working), its transform,
tracks and anchor (fraction anchors resolved to pixels), named "Traced <name>", holding one
fill-only path per region in the image's pixel coordinates. The stacking slot is kept (scene zOrder
renumbered). The image asset stays in the library. Refuses non-images, locked images, empty traces.

## Editor (slice 1)
Inspector, image selected: **Trace Bitmap…** opens colors / min area / curve fit / corners and
**Trace**. The React adapter decodes the asset through a canvas, downscaled to ≤ 1024 px on the long
side (`traceImage.ts`), runs `traceBitmap`, and calls store `traceBitmap(objectId, regions)` — one
undo step.

## Slice 2 (next) — agents
A small PNG decoder (fflate inflate) so core `traceBitmap` and MCP `trace_bitmap` work without a
browser; a command palette entry.
