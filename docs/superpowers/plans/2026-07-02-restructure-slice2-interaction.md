# Framework-Agnostic Restructure — Slice 2: Extract `@savig/interaction`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extract the pure, framework-neutral Stage geometry/interaction MATH into a new `@savig/interaction` package (deps: `@savig/engine` only), so the store can depend on it in Slice 3. Zero behavior change.

**Architecture:** Move 16 pure `.ts` files (+ their tests) out of `apps/react/src/ui/components/Stage/` into `packages/interaction/src/`, expose them via a barrel `index.ts` + wildcard `exports`, add a single `@savig/interaction` alias to the three resolver surfaces, and rewrite all 15 consumer files' imports from relative paths to `@savig/interaction`.

**Tech Stack:** pnpm workspace, TypeScript (central root `tsconfig.json` paths), Vite/Vitest, Playwright.

## Global Constraints

- **Zero behavior change.** Existing suite is the gate: ~1,711 unit + 109 e2e + `tsc --noEmit` + `pnpm lint`, all green. No new product tests; no test-logic changes except import-specifier rewrites.
- **`@savig/interaction` depends on `@savig/engine` ONLY.** None of the 16 movers import react, the store, selectors, or any other `apps/react/**` module (verified). Acyclic: `engine ← interaction`, and next slice `interaction ← editor-state`.
- **`buildDefs.ts` is NOT moved** — it imports `@savig/services` (a render helper, not interaction math, not store-consumed). It stays in `apps/react/src/ui/components/Stage/`; its only consumer (`Stage.tsx`) keeps the relative `./buildDefs` import. (It relocates to the render layer in a later slice.)
- **Barrel + wildcard exports**, mirroring `@savig/engine`: `exports: { ".": "./src/index.ts", "./*": "./src/*.ts" }`. All consumers import the bare `@savig/interaction` (barrel) — one alias entry per surface. Symbol names across the 16 files are collision-free.
- Use `git mv`. No per-package tsconfig / composite (central root tsconfig). Declare deps per package (W7).

---

## The 16 movers (exact list)
`align.ts, correspondenceOverlay.ts, drawGeometry.ts, gridSnap.ts, handleMath.ts, pathEdit.ts, pathHitTest.ts, pickRingTarget.ts, resizeHandles.ts, rotateHandle.ts, scaleHandles.ts, scaleSnap.ts, snapping.ts, spacingGuides.ts, stageCoords.ts, stageCursor.ts` — plus each co-located `*.test.ts`. (NOT `buildDefs.ts`.)

Intra-set relative edges that stay `./x` after the move (already correct): `align→./snapping`, `gridSnap→./snapping`, `pickRingTarget→./pathHitTest`, `resizeHandles→./handleMath`, `scaleHandles→./handleMath`, `scaleSnap→./snapping`, `spacingGuides→./snapping`, `stageCoords→./drawGeometry`.

## The 15 consumer files to rewrite (relative mover-import → `@savig/interaction`)
- **Store (4):** `apps/react/src/ui/store/store.ts` (imports from `../components/Stage/{pathEdit,snapping,stageCursor,align}`), `store-internals.ts` (`../components/Stage/{snapping,align}`), `slices/groupSymbolSlice.ts` (`../../components/Stage/snapping`), `store.test.ts` (`../components/Stage/{snapping,stageCursor}`).
- **Stage internals (9):** `Stage.tsx` (`./{snapping,rotateHandle,stageCursor,stageCoords,spacingGuides,correspondenceOverlay,resizeHandles,scaleHandles,pathHitTest}` — but KEEP `./buildDefs` relative), `useObjectDrag.ts` (`./{snapping,spacingGuides,gridSnap}`), `useMarqueeSelect.ts` (`./snapping`), `useDrawTool.ts` (`./drawGeometry`), `useNodeDrag.ts` (`./snapping`), `useBrushTool.ts` (`./drawGeometry`), `useRotateDrag.ts` (`./{snapping,rotateHandle}`), `usePathTools.ts` (`./{pathEdit,pickRingTarget}`), `useScaleDrag.ts` (`./{snapping,scaleSnap,gridSnap,scaleHandles,resizeHandles}`).
- **Other app (2):** `components/AssetPanel/thumbnailSvg.ts` (`../Stage/snapping`), `components/Inspector/Inspector.tsx` (`../Stage/snapping`).

---

### Task 1: Create `@savig/interaction` and move the 16 files

**Files:**
- Create: `packages/interaction/package.json`, `packages/interaction/src/index.ts`
- Move: the 16 `.ts` + their `.test.ts` → `packages/interaction/src/`
- Modify: `tsconfig.json` (paths), `vitest.config.ts` (alias + maybe env glob), `apps/react/vite.config.ts` (alias)

**Interfaces:**
- Produces: `@savig/interaction` barrel exporting all public symbols of the 16 files; deps `@savig/engine`.

- [ ] **Step 1: Create the package dir and move the files.**

```bash
mkdir -p packages/interaction/src
git mv apps/react/src/ui/components/Stage/align.ts apps/react/src/ui/components/Stage/align.test.ts packages/interaction/src/ 2>/dev/null
for f in correspondenceOverlay drawGeometry gridSnap handleMath pathEdit pathHitTest pickRingTarget resizeHandles rotateHandle scaleHandles scaleSnap snapping spacingGuides stageCoords stageCursor; do \
  git mv "apps/react/src/ui/components/Stage/$f.ts" "packages/interaction/src/$f.ts"; \
  [ -f "apps/react/src/ui/components/Stage/$f.test.ts" ] && git mv "apps/react/src/ui/components/Stage/$f.test.ts" "packages/interaction/src/$f.test.ts"; \
done
```
(Verify `buildDefs.ts` and `buildDefs.test.ts` — if any — remain under Stage. Verify the intra-set `./x` sibling imports are untouched.)

- [ ] **Step 2: Create the barrel `packages/interaction/src/index.ts`** — one `export *` per moved file:

```ts
export * from './align';
export * from './correspondenceOverlay';
export * from './drawGeometry';
export * from './gridSnap';
export * from './handleMath';
export * from './pathEdit';
export * from './pathHitTest';
export * from './pickRingTarget';
export * from './resizeHandles';
export * from './rotateHandle';
export * from './scaleHandles';
export * from './scaleSnap';
export * from './snapping';
export * from './spacingGuides';
export * from './stageCoords';
export * from './stageCursor';
```

- [ ] **Step 3: Create `packages/interaction/package.json`:**

```json
{
  "name": "@savig/interaction",
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts", "./*": "./src/*.ts" },
  "dependencies": { "@savig/engine": "workspace:*" }
}
```

- [ ] **Step 4: Add the alias to all three resolver surfaces** (single entry each):
  - `tsconfig.json` `paths`: `"@savig/interaction": ["packages/interaction/src/index.ts"]`
  - `vitest.config.ts` `alias` (both `resolve.alias` and `test.alias` if separate — match the file's existing shape): `'@savig/interaction': r('./packages/interaction/src/index.ts')`
  - `apps/react/vite.config.ts` `alias`: `'@savig/interaction': r('../../packages/interaction/src/index.ts')`

- [ ] **Step 5: Rewrite the 15 consumers' mover-imports to `@savig/interaction`.** For each consumer file listed above, change the module specifier of each mover-import to `@savig/interaction`, merging multiple mover-imports in the same file into (or leaving as) `@savig/interaction` imports — the barrel exports every symbol. **In `Stage.tsx`, leave the `./buildDefs` import unchanged** (buildDefs did not move). Example (`store.ts`): `from '../components/Stage/snapping'` → `from '@savig/interaction'`; `from '../components/Stage/pathEdit'` → `from '@savig/interaction'`; etc. After rewriting, confirm no relative import to a moved file remains: `grep -rn "components/Stage/\(align\|snapping\|pathEdit\|stageCursor\|scaleHandles\|resizeHandles\|scaleSnap\|gridSnap\|spacingGuides\|rotateHandle\|pathHitTest\|pickRingTarget\|handleMath\|drawGeometry\|stageCoords\|correspondenceOverlay\)\b" apps/react/src` and `grep -rn "\./\(snapping\|align\|pathEdit\|...\)" apps/react/src/ui/components/Stage/*.tsx apps/react/src/ui/components/Stage/use*.ts` should show none (except `./buildDefs`).

- [ ] **Step 6: Install + verify env.** `pnpm install`. If any moved test fails under the default `node` Vitest env because it needs DOM (e.g. SVG matrix / DOMParser), add `['packages/interaction/src/**', 'jsdom']` to `environmentMatchGlobs` in `vitest.config.ts`. Determine empirically from the test run.

- [ ] **Step 7: Full gate — ALL must pass:**

Run: `pnpm typecheck && pnpm test && pnpm lint && pnpm e2e`
Expected: `tsc --noEmit` clean; ~1,711 unit passing (same count, files now include `packages/interaction/src/*.test.ts`); lint clean; 109 e2e passing.

- [ ] **Step 8: Commit.**

```bash
git add -A
git commit -m "refactor: extract @savig/interaction (16 pure Stage math files, barrel + wildcard exports)"
```

---

## Self-Review (against constraints)

- **Coverage:** package creation (Task 1 s1–3), alias surfaces (s4), consumer rewrite (s5), env (s6), gate (s7). buildDefs exclusion honored (s1, s5). ✅
- **Placeholder scan:** the grep in s5 abbreviates the file list with `...` — the implementer must expand it to the full 16-name alternation; every mover name is listed in "The 16 movers" above. No TBDs.
- **Cycle check:** interaction → engine only; no mover imports the app/store/react (verified in exploration). buildDefs (the one services-importer) excluded. ✅
- **Type/name consistency:** package `@savig/interaction`; barrel re-exports all 16; single alias entry per surface. Consumers all collapse to `@savig/interaction`. ✅
