# CSS-only export — slice 2 plan (editor)

Spec: `specs/2026-11-14-css-export-design.md`.

- [x] `CommandHost.exportCssSvg`; command `file.exportCssSvg` "Export CSS-animated SVG" (palette).
- [x] React `fileOps.exportCssSvg` (save `.svg`, toast on failure) + command host wiring; host
      stubs in keymap / registry / palette / keyboard tests.
- [x] Tests: registry + fileOps unit tests; e2e palette download (`css-svg-export.spec.ts`).
