# Plan: Static-symbol `<use>` export optimization (slice 47g)

**Date:** 2026-06-28  
**Spec:** `specs/2026-06-28-savig-m4-static-symbol-use-export-design.md`

---

## Task list

### Task 1: Add `isStaticSymbol` + `isStaticInstance` predicates to `src/engine/duration.ts`
- [ ] Export `isStaticSymbol(asset: SymbolAsset, assetsById: Map<string, Asset>): boolean`
  - `symbolEffectiveDuration(asset) === 0` AND recursively check nested symbol instances
  - Cycle guard via visited Set
- [ ] Export `isStaticInstance(instance: SceneObject): boolean`
  - No `symbolTimeTrack` (absent or empty)
  - No `symbolTime` field (conservative: any non-default timing → false)
  - No `tint`
  - No `freezeFirstFrame`
- [ ] Add unit tests in `src/engine/duration.test.ts`

### Task 2: Write failing tests in `renderDocument.test.ts`
- [ ] Test: two static instances → one def + two `<use href="#savig-sym-...">` (FAILS — no `<use>` today)
- [ ] Test: animated symbol stays inlined (currently PASSES — write to ensure no regression)
- [ ] Test: `<use>` transform matches instance world transform
- [ ] Test: tinted static instance falls back to inlining (no `<use>`)
- [ ] Test: clipped static instance falls back to inlining (no `<use>`)
- [ ] Test: mixed project (static + animated)
- [ ] Test: `symbolTime` instance excluded
- [ ] Test: `freezeFirstFrame` instance excluded
- [ ] Test: nested static symbol → `<use>` def contains inner content inlined
- [ ] Test: output is deterministic

### Task 3: Implement `buildStaticSymbolDef` helper in `renderDocument.ts`
- [ ] Helper: `buildStaticSymbolDef(assetId, assetsById, project, gradientDefs): string`
  - Walk `asset.objects` as a mini-scene (use same renderLeaf logic, prefix="", idPrefix="")
  - Return `<g id="savig-sym-<assetId>">…leaves…</g>`
  - Collect gradient defs as side effect
  - Handle nested symbol instances inside the def (recursively render their leaves)
- [ ] Implement `buildStaticOptimizableInstances` that scans `project.objects` for static instances
  and returns `Map<instanceId, { assetId, transform, opacity }>`

### Task 4: Wire into `renderSvgDocument` body loop
- [ ] Compute `staticOptimizable` map before body loop
- [ ] In body loop: detect leaf whose top-level instance is in `staticOptimizable`
  - First time: emit `<use>`, emit def (if not yet), skip all leaves of this instance
  - Subsequent leaves of same instance: skip only (already emitted)
- [ ] Non-optimizable instances: fall through to existing path (clip/tint/plain)
- [ ] Static sym defs go into `<defs>` before or after existing SVG-asset defs
- [ ] Green tests

### Task 5: Verify non-regression
- [ ] All existing tests pass
- [ ] TypeScript typechecks clean (`pnpm tsc --noEmit`)
- [ ] ESLint clean
- [ ] Editor Stage not touched (verify no changes to Stage.tsx)

### Task 6: Code review (subagent)
- [ ] Dispatch reviewer on final diff
- [ ] Resolve any Critical/Important findings
- [ ] Re-review until clean

### Task 7: Merge + record
- [ ] Merge feature branch to main with `--no-ff`
- [ ] Record in INDEX.md
- [ ] Delete feature branch
