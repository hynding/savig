# Bitmap import — slice 2 plan (editor)

Spec: `specs/2026-11-15-bitmap-import-design.md`.

- [x] services `importImage(name, bytes)` + `sniffImage`: type sniffed from magic bytes, natural
      size read from the PNG / GIF / JPEG (SOF) / WebP (VP8, VP8L, VP8X) header, 10 MB cap,
      content-hash id, `ImageImportError`.
- [x] Asset panel "Import Image" (imports and places one object), image library rows (click to
      place another), rename/delete as for other library assets.
- [x] Stage accepts dropped image files: each is imported and centred on the drop point; a
      non-image file is refused with a toast.
- [x] store `addObject(assetId, at?)` centres a box asset on a point; `toggleGuide(ids?)` (one
      undo step, locked objects skipped).
- [x] Inspector: "Image · W × H px" row, Guide checkbox on objects and groups; Layers "Guide"
      badge; palette command `arrange.toggleGuide`.
- [x] Tests: header sniffing for all four formats, import errors, store, VMs, command, e2e (import,
      export contains the image, guide drops it from the export, undo, drop on Stage centred,
      non-image refused).
