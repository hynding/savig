# Image-sequence import — design

Roadmap 7, item 3. Flash's "import sequence": numbered pictures (walk01.png, walk02.png, …) become
a frame-by-frame layer, one key per picture.

## Model
No new data. `buildImageSequence(images, opts)` (engine) returns an ordinary frame layer
(`createFrameLayer`, keys `<layerId>-k<i>` from `start`, `hold` frames apart, `end` after the last)
plus one image object per key (`<layerId>-f<i>`, direct child, `frameKeyId` set, top-left at the
layer origin, centre pivot). The layer's position is the shared top-left, so equal-size frames line
up. Onion skin, F5/F6/F7, shape tween refusal (bitmaps aren't tweenable) and every export already
handle frame layers of images.

Order: `naturalCompare` (numeric-aware, case-insensitive) on file names: frame2 before frame10.

## Surfaces
- Engine: `buildImageSequence`, `naturalCompare`.
- Editor: Asset panel "Import Sequence" (multi-file picker; unreadable files toast and are
  skipped). Store `importImageSequence(images, { hold?, name? })`: keys from the frame-snapped
  playhead, first picture centred on the artboard, layer named after the file stem, identical
  pictures share one content-hashed asset, one undo step, selects the layer, toast.
- Core `addImageSequence(project, { frames, x?, y?, hold?, start?, id?, name? })` (default: first
  picture centred); MCP `import_image_sequence` (`folder` in natural order, `paths` or `dataUrls`).
