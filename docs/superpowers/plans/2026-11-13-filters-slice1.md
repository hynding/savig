# Filters & Color Effects — Slice 1 (Model + Engine + Render Seam) Implementation Plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax for tracking; boxes are left
> unchecked in-file by convention (see INDEX).

**Goal:** stackable, animatable filters (`blur`, `dropShadow`, `glow`, `adjustColor`) exist in the
model and render identically everywhere that goes through the shared seam: Stage preview, exported
runtime, SMIL export, raster/GIF/video, MCP `render_frame`. No editor UI in this slice; filters are
authored as JSON (`filters` / `filterTracks`) or with `createFilter`.

**Spec:** `docs/superpowers/specs/2026-11-13-filters-design.md` §Model, §Engine, §Render & export,
§Persistence.

## Global constraints

- **Parity:** no enabled filter anywhere ⇒ byte-identical output (no `wrapChain`, no defs, no
  wrappers, no extra frame items).
- **One builder:** `filterPrimitives` feeds the export string, the Stage JSX, the runtime DOM
  rebuild and the SMIL sampler.
- Wrappers carry no transform, so filters work in stage space (a rotated object's shadow still
  falls down-right, as in Flash).
- Rebuild `packages/runtime/src/runtimeSource.generated.ts` (`pnpm build:runtime`).

---

### Task 1: Model + engine
- [ ] `FilterKind`, `ObjectFilter`, `SceneObject.filters?`, `SceneObject.filterTracks?` (types.ts).
- [ ] `filters.ts`: `FILTER_PARAMS` (defaults + clamps), `sampleFilters`, `filterPrimitives`,
      `filterDefId`, `createFilter`, `symbolUsesFilters`, `WrapRef`, `ownWrapChain`,
      `sameWrapChain`, `leafWrapChain`; `groupAncestors` exported from mask.ts.
- [ ] `flattenInstances`: `InstanceLeaf.wrapChain` (masks + filters interleaved, outermost first,
      inherited through instances; omitted when no filter applies; mask content gets none).
- [ ] `objectsMaxKeyframeTime` folds `filterTracks`.
- [ ] Tests: `engine/src/filters.test.ts`.

### Task 2: Render seam
- [ ] `renderSceneBody`: `WrapperStack` replaces the mask-only stack; `<filter>` defs (once per id,
      `data-savig-object` = id); clip/tint runs split on the whole wrap chain; multi-scene prefix.
- [ ] Static `<use>` optimization skips filtered instances (own or via a group) and symbols
      containing filters.
- [ ] Runtime `computeFrame` appends one `kind: 'filter'` item per def; `applyFrameToNodes`
      rebuilds its children (`applyFilterPrims`, createElementNS) and never sets transform/opacity.
- [ ] SMIL: per-primitive `<animate>` for each changing attribute.
- [ ] Stage: JSX `<filter>` defs (registered with the painter, keyed by structure) + the same
      wrapper stack.
- [ ] Tests: `services/src/export/filters.test.ts`, Stage parity, resvg pixel tests in
      `core/src/node/render.test.ts`.

### Task 3: Persistence
- [ ] Format v10 (stamp-only), `createProject` v10, `sanitizeFilters` (drops unknown kinds,
      duplicate ids, non-finite/unknown params, non-string colors, bad track keys/keyframes).

### Task 4: Verify
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint`, Playwright (react + svelte).
