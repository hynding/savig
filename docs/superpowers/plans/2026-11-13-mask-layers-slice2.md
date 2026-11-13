# Mask Layers — Slice 2 (Editor) Implementation Plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax for tracking; boxes are left
> unchecked in-file by convention (see INDEX).

**Goal:** A user can make, move, inspect and remove masks in the editor without touching JSON.

**Spec:** `docs/superpowers/specs/2026-11-13-mask-layers-design.md` §Editor.

### Task 1: Store verbs
- [ ] `packages/editor-state/src/slices/maskSlice.ts`: `createMask`, `releaseMask`,
      `unmaskSelected` (active-scene aware, one commit each, toast on refusal); wired into the store.
- [ ] `deleteSelectedObject` unlinks objects whose mask was deleted.
- [ ] `store.masks.test.ts`: topmost-is-mask, undo, refusals, skip masks/locked targets, inside an
      edited symbol, release from either side, unmask, delete cleanup.

### Task 2: Commands + view-models
- [ ] Predicates `canCreateMask`, `canReleaseMask`, `canUnmask`; registry entries
      `arrange.createMask` (Ctrl/⌘+Alt+M), `arrange.releaseMask`, `arrange.unmask`.
- [ ] Layers VM `maskRole` / `maskName`; Inspector VM `canCreateMask` (multi) and `mask`
      (single, group) + intents. Tests in `layersPanel.test.ts`, `inspector.test.ts`.

### Task 3: React UI
- [ ] Layers panel badges; Inspector Create Mask / Release Mask / Unmask.
- [ ] Stage mask ghosts (outline-only hit target, move-drag via `onObjectPointerDown`, hidden in
      preview). Stage tests.

### Task 4: e2e
- [ ] `e2e/mask-layers.spec.ts`: draw target + mask, Ctrl+Alt+M, assert `<mask>` def + wrapper +
      badges + Inspector, drag the ghost (mask content transform changes), undo/redo, Release.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint`, full Playwright suite.
