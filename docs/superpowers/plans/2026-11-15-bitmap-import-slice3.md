# Bitmap import — slice 3 plan (agent surfaces)

Spec: `specs/2026-11-15-bitmap-import-design.md`.

- [x] core `addImage(project, { src, x, y, width?, height?, id?, name?, guide? })`: `src` is a safe
      base64 data URL or raw bytes (sniffed); (x, y) is the top-left of the DISPLAYED box,
      width/height become scaleX/scaleY about the centre pivot (one given keeps the aspect).
- [x] core `setGuide(project, ids, guide = true)`.
- [x] DSL `{ type: 'image', src, x, y, width?, height? }` (any ShortShape slot, so frames keys can
      hold images); `guide: true` on any object (rides the mask-field seam, so frames layers and
      bones get it too); decompile round-trips; `trim` on an image is refused.
- [x] describe: `GUIDE (editor only, not exported)`, `image W×Hpx <type>`.
- [x] validate: `image-bad-src` (error), `mask-is-guide` (warn).
- [x] MCP `add_image` (`path` to a local file or `dataUrl`, plus `guide`, layer/time targeting),
      `set_guide`; `load_dsl` documents image objects and `guide`.
- [x] Template "Photo pan": an embedded 96×54 PNG stretched to the stage, zoomed and drifted under
      a fading title.
- [x] Tests: builders (incl. resvg check of the scaled box's top-left), DSL round trip, describe,
      validate, MCP tools, template suite.
