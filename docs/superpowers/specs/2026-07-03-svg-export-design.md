# SVG Export — Design (Help slice 4, feasible piece)

**Date:** 2026-07-03 · **Status:** Approved (autonomous), pre-implementation

## Context & re-scope
Brainstorm slice 4 was "expose MCP-only features (camera; GIF/PNG/SVG export)." Investigation shows
that full scope is milestone-sized and partly infeasible in the browser:
- **PNG / GIF export** — `renderFramePng`/`renderGif` (`packages/core/src/node/`) use native
  `@resvg/resvg-js` + `gifenc`; they run only in Node (MCP/CLI). Exposing them in the browser needs a
  canvas-based rasterizer — a substantial separate effort. **Deferred.**
- **Camera authoring** — the Stage already *renders* a camera (`Stage.tsx:72`), but there are **no
  store actions** for camera (only core/MCP `setCamera`/`cameraMove`). A UI needs new store actions +
  a camera panel + an animated timeline camera track + keyframe editing — a milestone. **Deferred.**
- **SVG snapshot export** — `renderProjectDocument` (`@savig/services`) is pure/browser-safe (built on
  `renderSvgDocument`, already used in-app for thumbnails). **Feasible now** → this slice.

This slice delivers **SVG snapshot export** (see the accuracy note below); camera authoring and raster
(PNG/GIF) export are documented follow-ups with the findings above.

## What the artifact is (accuracy)
`renderProjectDocument`/`renderSvgDocument` emit **static, frame-0** markup instrumented with
`data-savig-object` ids — the animation is applied by the separate runtime (bundled only in the `.zip`
export). So a bare `.svg` opened directly is a **static vector snapshot**, not a self-playing
animation. The command is therefore labeled **"Export SVG snapshot"** (not "animated"). A truly
self-contained animated single-file SVG (inline runtime + project JSON) is a follow-up; the animated
artifact today is the `.zip` bundle (existing "Export").

## Goal
Let the user export a static SVG snapshot of the project (the same markup the MCP `export_svg` tool
produces), discoverable from the command palette.

## Design
- **`fileOps.exportSvg()`** (`apps/react/src/ui/fileOps.ts`): `renderProjectDocument(present)` — which
  routes multi-scene projects correctly (plain `renderSvgDocument` reads the empty root `objects` and
  emits a blank body for multi-scene) — → encode to bytes (`TextEncoder`) →
  `saveBytesToDisk(bytes, '<name>.svg', 'image/svg+xml')`
  (which downloads via the anchor fallback when the File System Access picker is unavailable).
  Wrapped in try/catch → `pushToast('error', …)` like the other file ops.
- **`CommandHost.exportSvg()`** (neutral interface) → `fileOps.exportSvg()`.
- **Registry command `file.exportSvg`** ("Export animated SVG", File category, no chord,
  keywords `['svg','export']`) → `ctx.host.exportSvg()`. Palette-discoverable.
- **No new toolbar button** — the toolbar is width-constrained (a wide button overflows and breaks
  coordinate-based drag/snap e2e tests, per the slice-2 finding). Discovery is via the palette; a
  unified Export menu (Bundle / SVG / …) is a follow-up.

## Testing
- `fileOps` unit: `exportSvg()` calls `renderSvgDocument` and `saveBytesToDisk` with a `.svg` name +
  `image/svg+xml` mime, carrying the rendered markup (mock `@savig/services`).
- Registry unit: `file.exportSvg` command calls `host.exportSvg`.
- e2e: open the palette → run "Export animated SVG" → capture the browser download and assert its
  filename ends in `.svg`.

## Out of scope / follow-ups
- **Truly self-contained animated single-file SVG** (inline runtime + project JSON in a `<script>`).
- **Raster export (PNG/GIF)** in the browser (needs a canvas rasterizer).
- **Camera authoring UI** (store actions + panel + animated timeline track) — the biggest remaining
  MCP-only gap; recommend scoping as its own milestone.
- A visible/unified Export menu in the toolbar.
