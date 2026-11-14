# Inverted and luminance masks — Design

**Date:** 2026-11-14
**Status:** in progress (slice 1)

## Goal

Mask layers (spec 2026-11-13) reveal what they mask through the mask's **area** (alpha). Two
standard variants are missing:

- **Inverted** — the mask *hides* its area and reveals everything else (a keyhole cut out of a
  scene, a "hole punch" title, a spotlight that darkens instead of lights).
- **Luminance** — the mask's **brightness** reveals: white shows, black hides, greys and gradients
  give soft, colour-driven reveals (fading wipes from a gradient rectangle, a texture as a mask).

Both combine (an inverted luminance mask: dark areas reveal).

## Model (engine `types.ts`, on the `isMask` object)

```ts
/** Mask type: 'luminance' = brightness reveals (white shows, black hides). Absent = alpha (area). */
maskType?: 'luminance';
/** Inverted mask: what the mask covers is HIDDEN and the rest shows. */
maskInvert?: boolean;
```

Only meaningful on an `isMask` object; ignored elsewhere. No format bump (optional fields; absent =
today's alpha mask, byte-identical output).

## Render (one seam, every target)

`flattenInstances` copies the content root's style onto each mask-content leaf as
`maskStyle?: { luminance?: true; invert?: true }` (absent for a plain alpha mask → parity). Engine
`maskDefParts(id, style)` describes the defs so the export string builder and the Stage's JSX emit
the same structure:

- Not inverted: `<mask id=X mask-type="alpha|luminance">content</mask>` (as today, type varies).
- Inverted: the content goes into `<mask id=X-src mask-type=…>` and the referenced mask is
  `<mask id=X mask-type="luminance"><rect fill="#fff"/><rect fill="#000" mask="url(#X-src)"/></mask>`
  (both rects cover the huge mask region). Luminance of X = 1 − (source coverage), i.e. the exact
  complement of the non-inverted mask for both alpha and luminance sources. No filters (no filter
  region / colour-space pitfalls); nested masks are supported by browsers and resvg.

Masked objects keep wrapping in `<g mask="url(#X)">`, so the wrapper stack, runtime, SMIL, CSS and
raster paths need no change: mask content still carries `data-savig-object`.

An inverted mask with **no content leaves at all** (an empty mask group) emits no def, like today:
its objects render as for an empty mask. A frame-layer mask always emits its leaves (exposure only
toggles visibility), so an inverted frame-layer mask between keys reveals everything, as expected.

## Editor (slice 1)

- Store `setMaskStyle(patch: { maskType?: 'alpha' | 'luminance'; maskInvert?: boolean }, maskId?)`
  — defaults to the selected mask; one undo step; a no-op change commits nothing. `releaseMask` also clears the style fields.
- Inspector mask row: **Mask type** select (Alpha / Luminance) and an **Invert** checkbox, shown
  for a mask (`InspectorMaskVM.maskType`, `.inverted`); the row reads "hides N objects" when
  inverted.
- Layers panel: the mask badge reads "Mask", "Inverted mask", "Luma mask" or "Inverted luma mask".
- Commands `arrange.invertMask` ("Invert mask") and `arrange.lumaMask` ("Toggle luminance
  mask") toggle the selected mask.
- Sanitizer: a `maskType` other than 'luminance' or a non-boolean `maskInvert` is dropped;
  `maskInvert: false` is dropped too.

## Agents (slice 2)

- Core `createMask(project, maskId, targetIds, { invert?, luminance? })` and
  `setMaskStyle(project, maskId, { invert?, luminance? })`; `reveal` macro takes `invert`.
- DSL: `maskType: 'luminance'`, `maskInvert: true` on a shape with `mask: true`.
- describe: `mask (inverted, luminance)`.
- MCP: `create_mask` takes `invert` / `luminance`; new `set_mask_style`.
- validate: a style on a non-mask object is a warning.
- Template: a keyhole (inverted) or gradient-wipe (luminance) short.

## Slices

1. Model, engine leaf style + `maskDefParts`, export and Stage defs, sanitizer, editor store /
   Inspector / Layers / command, tests (engine, export, raster parity, store, e2e).
2. Agent surfaces: core, DSL, describe, MCP, validate, template.
