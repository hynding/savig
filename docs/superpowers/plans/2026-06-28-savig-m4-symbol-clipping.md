# Symbol Content Clipping — Implementation Plan

**Date:** 2026-06-28  
**Branch:** slice-symbol-clip  
**Spec:** specs/2026-06-28-savig-m4-symbol-clipping-design.md

---

## Task 1: Add `clip` flag to SymbolAsset type

**File:** `src/engine/types.ts`

Add `clip?: boolean` to `SymbolAsset` after the `duration` field with a docstring.

---

## Task 2: Extend InstanceLeaf + update flattenInstances

**File:** `src/engine/symbol.ts`

Add optional `clipId?: string` and `clipTransform?: string` to `InstanceLeaf`.

In `flattenInstances`, when expanding a symbol instance where `asset.clip === true`:
- Generate a `clipId = `clip-${renderId}`` (unique per instance path).
- Pass `clipId` and `clipTransform` (= `instTransform`) down to each leaf produced by `walk(asset.objects, ...)`.
- Implement by threading `clipId`/`clipTransform` through the recursive `walk` signature (new optional params).

**Write tests first** in `src/engine/symbol.test.ts`:
- Clip-enabled symbol: leaves have `clipId` + `clipTransform`.
- Non-clip symbol: leaves have no `clipId`.
- Parity: all existing tests still pass.

---

## Task 3: Update export (renderDocument.ts)

**File:** `src/services/export/renderDocument.ts`

After building `leaves`:
1. Collect unique `{ clipId, clipTransform, width, height }` groups (from the leaf's asset, looked up by the first leaf in each group).
2. Emit `<clipPath id="clipId" clipPathUnits="userSpaceOnUse"><rect x="0" y="0" width="W" height="H" transform="clipTransform"/></clipPath>` into `defs`.
3. Group leaves by `clipId`. For clipped groups, wrap the leaf markup in `<g clip-path="url(#clipId)">...</g>`.

The body must preserve zOrder (leaves are already zOrder-sorted by flattenInstances). Clipped leaves in the same instance are contiguous (flattenInstances processes them depth-first), so wrapping the contiguous run is safe. For multi-instance clipping, each instance has a distinct `clipId`.

**Write tests first** in `src/services/export/renderDocument.test.ts`:
- Clipping symbol emits `<clipPath>` in defs and `clip-path` attribute on the group.
- Clipping symbol with two instances emits two distinct `<clipPath>` elements.
- Non-clipping symbol: output unchanged (byte-identical assertion).

---

## Task 4: Update Stage.tsx

**File:** `src/ui/components/Stage/Stage.tsx`

The Stage render loop (`renderLeaves.map(...)`) currently emits one element per leaf. With clipping:

1. Pre-process `renderLeaves` into a list of "render groups": a `{ clipId, clipTransform, asset }` header followed by the leaves in that clip, OR a bare leaf for non-clipped leaves.
2. For each clip group, emit `<g clipPath="url(#clipId)">` wrapping the leaf elements.
3. Emit a `<clipPath id="clipId" clipPathUnits="userSpaceOnUse"><rect x="0" y="0" width="W" height="H" transform="clipTransform"/></clipPath>` into the SVG's `<defs>` (currently `buildDefs` handles this; extend it or emit inline with a React fragment in defs).

The `buildDefs` function builds a `<defs>` string from assets. For clip paths, emit them as React elements directly in the JSX `<defs>` block alongside `buildDefs` output (or extend `buildDefs` to accept clipPaths — prefer inline React for type-safety).

**Write RTL test first** in `src/ui/components/Stage/Stage.test.tsx` (or similar):
- Render a minimal project with a clipping symbol instance.
- Assert the Stage SVG contains a `<clipPath>` element.
- Assert the leaf `<g>` is inside a `<g clip-path>` wrapper.

---

## Task 5: Add store action `setSymbolClip`

**File:** `src/ui/store/store.ts`

Add to `EditorState`:
```ts
setSymbolClip(symId: string, clip: boolean): void;
```

Implementation: find asset by `symId`, toggle `clip`, commit.

---

## Task 6: Add UI toggle in Inspector

**File:** `src/ui/components/Inspector/Inspector.tsx`

Inside the `isSymbolInstance(obj, assets)` block, add a "clip content" checkbox row that:
- Reads `(asset as SymbolAsset).clip ?? false`.
- Calls `setSymbolClip(obj.assetId, checked)` on change.

---

## Task 7: E2E test

**File:** `e2e/symbols.spec.ts`

Add a test:
1. Draw two rects inside a symbol (one far outside the symbol's content bounds).
2. Enable "clip content" in Inspector.
3. Confirm a `<clipPath>` element appears in the Stage SVG.
4. Disable "clip content" and confirm it disappears.

---

## Task 8: Run all tests, typecheck, lint

```sh
pnpm vitest run
pnpm tsc --noEmit
pnpm eslint src/engine/types.ts src/engine/symbol.ts src/services/export/renderDocument.ts src/ui/store/store.ts src/ui/components/Inspector/Inspector.tsx src/ui/components/Stage/Stage.tsx
pkill -f vite; pnpm exec playwright test e2e/symbols.spec.ts
```

---

## Task 9: Dispatch reviewer subagent

Review the diff for correctness, parity, and type safety.

---

## Task 10: Merge + record in INDEX

```sh
git checkout main
git merge --no-ff slice-symbol-clip
git branch -d slice-symbol-clip
```

Append a row to `docs/superpowers/INDEX.md`.
