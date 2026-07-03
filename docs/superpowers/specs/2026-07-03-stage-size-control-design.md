# Stage-Size Control — Design

**Date:** 2026-07-03
**Status:** Approved design, pre-implementation

## Problem

There is no interactive UI to change the stage (artboard) size after project creation. Dimensions
live on `ProjectMeta.width` / `ProjectMeta.height` (`packages/engine/src/types.ts:384-385`),
default to `1280×720` (`packages/engine/src/project.ts:54-55`), and today can only be set at
creation time via `createProject`, a template, the MCP `create_project` tool, or a file load. No
store action mutates `meta.width/height`.

## Goal

Let the user set the active artboard's width and height from the Inspector when nothing is
selected, with sensible presets, fully undoable, without moving any content.

## Decisions (from brainstorming)

- **Placement:** Inspector, in the "nothing selected" (empty) state — a Document/Symbol size panel.
- **Content behavior:** Nothing moves. Only the artboard bounds change (Figma-frame semantics).
- **Scope:** Resize *whatever is active* via `activeSceneDims` — the root `meta` normally, or the
  edited symbol's `width/height` in symbol-edit mode.

## Architecture

Follows the established neutral-core / view-model / intent / framework-UI split.

### 1. Store action — `packages/editor-state/src/store.ts`

Add `setStageSize(width: number, height: number)` (and to the store type interface):

- Resolve `selectActiveAssetId(s)`. If it resolves to a `kind: 'symbol'` asset → mutate that
  asset's `width/height` (mirroring `setSymbolDuration`, `store.ts:1109`). Otherwise → mutate
  `meta.width/height`.
- Clamp each dimension: `Math.round(Math.max(1, n))` (positive integers; avoids a `0`/negative
  viewBox).
- No-op guard: if both clamped dims equal the current values, return without committing (no spurious
  undo step) — mirrors `setSymbolDuration`.
- Route through `get().commit(next)` so the change is pushed onto history and is undoable.

Root path:
```
commit({ ...project, meta: { ...project.meta, width: w, height: h } })
```
Symbol path:
```
commit({ ...project, assets: project.assets.map((a) => (a.id === symId ? { ...a, width: w, height: h } : a)) })
```

This is the authoritative clamp — the intent, MCP, and unit tests may call it directly.

### 2. View-model — `packages/ui-core/src/viewmodels/inspector.ts`

Enrich the single `empty` VM return site (`inspector.ts:217`):

```
{ kind: 'empty', dims: { width, height }, scope: 'root' | 'symbol' }
```

- `dims` from `activeSceneDims(s)` (already handles the root-vs-symbol resolution).
- `scope` = `'symbol'` when `selectActiveAssetId(s)` resolves to a symbol asset, else `'root'`.
  Drives the panel label ("Document" vs "Symbol size").

Both `activeSceneDims` and `selectActiveAssetId` are already imported by this module.

### 3. Intent + presets — `packages/ui-core` (framework-neutral)

- `setStageSize(w, h)` intent in `inspectorIntents` → `store.getState().setStageSize(w, h)`.
- `STAGE_PRESETS` const (neutral data, so the Svelte app can adopt later):
  - 720p — 1280×720
  - 1080p — 1920×1080
  - Square — 1080×1080
  - Portrait — 1080×1920

### 4. React UI — `apps/react/src/ui/components/Inspector/Inspector.tsx`

Replace the empty-branch hint (`Inspector.tsx:130`,
`<div className={styles.hint}>No object selected</div>`) with a size panel:

- Heading from `vm.scope` ("Document" or "Symbol size").
- Two `NumberField`s (W, H) with `min={1}`, `onCommit` → `intents.setStageSize`.
- A preset `<select>`:
  - A leading `Custom` option, selected and inert when the current dims match no preset (so the
    dropdown never mislabels the size).
  - One option per `STAGE_PRESETS` entry; selecting one calls `intents.setStageSize(preset.w, preset.h)`.

### 5. `NumberField` hardening — same file

Add an optional `min?: number` prop:

- In `commit`: `const raw = Number(draft); const n = min != null ? Math.max(min, raw) : raw;`
- Call `onCommit(n)` when `Number.isFinite(n) && n !== value` (unchanged logic, clamped input).
- When `min != null && n !== raw`, `setDraft(String(n))` so the visible field self-heals after a
  clamp (fixes the stale-draft case where the store's no-op guard would otherwise leave a bad `0`
  showing).
- `min` defaults to `undefined` → every existing `NumberField` caller is byte-identical.

## Data Flow

```
NumberField.onCommit / preset <select>
  → intents.setStageSize(w, h)
  → store.setStageSize (clamp + no-op guard)
  → commit(next)  [history push → undoable]
  → Stage re-derives viewBox = `0 0 {meta.width} {meta.height}` and re-clamps drags
```

No `SceneObject` is mutated; content keeps its absolute coordinates.

## Testing

- **Unit (editor-state store):**
  - Root: `setStageSize(w, h)` updates `meta.width/height`, is undoable, no-op-guards an unchanged
    call, and clamps `0`/negatives to `1`.
  - Symbol-edit: with a symbol active, `setStageSize` mutates that symbol asset's `width/height`
    and leaves `meta` untouched; a symbol with `clip: true` has its clip box follow the new size.
- **Unit (ui-core inspector):** the `empty` VM reports correct `dims` and `scope` at the root and
  inside a symbol. (Existing `kind === 'empty'` assertion still holds.)
- **e2e (React):** with nothing selected, the Inspector shows W/H inputs; changing W updates the
  Stage `viewBox`; undo restores the previous size.

## Notes & Warnings

- **Resize is project-wide across scenes.** `Scene` (`types.ts:416`) has no size — all scenes share
  `meta.width/height`, so one resize applies to the whole multi-scene sequence. There is no
  per-scene size and none is added.
- **Symbol resize is global to all instances.** In symbol-edit scope the change alters the symbol's
  intrinsic size for every instance (library thumbnails) and, when `clip: true`, the clip box
  `[0,width]×[0,height]`. This is intended per the "resize whatever's active" decision.
- **No persistence migration.** `meta.width/height` and symbol `width/height` are already persisted;
  `ProjectMeta.version` is unchanged.
- **Portability.** The neutral pieces (store action, VM enrichment, intent, presets) are
  framework-agnostic; only `apps/react` gets UI wiring. The Svelte app does not consume the
  inspector VM, and the `@portable` cross-app render contract asserts render parity (unaffected).

## Out of Scope (YAGNI)

- Content reflow/clamping into the new bounds.
- Svelte UI wiring (neutral pieces are ready for a later adopter).
- Aspect-ratio lock.
- A duplicate control in the FileToolbar or Timeline.
- An MCP tool to resize an existing project.
