# Framework-Agnostic Restructure — Slice 3: Extract `@savig/editor-state` (vanilla store)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move the Zustand store into a framework-neutral `@savig/editor-state` package, swapping React-bound `create` for `zustand/vanilla` `createStore`, with a thin React binding (`useEditor`) left in `apps/react` so all 2,927 static call sites and 60+ consumer imports stay unchanged. Zero behavior change.

**Architecture:** `@savig/editor-state` exports a vanilla `store` (StoreApi) + selectors + types (deps: `@savig/engine`, `@savig/interaction`, `zustand`). `apps/react/src/ui/store/store.ts` becomes a shim defining `useEditor = Object.assign((sel)=>useStore(store, sel), store)`; `apps/react/src/ui/store/selectors.ts` becomes a re-export shim. Consumers' import paths (`../store/store`, `../store/selectors`) are preserved byte-for-byte.

**Tech Stack:** pnpm workspace, TypeScript (central root tsconfig paths), Vite/Vitest, Playwright, zustand v5.

## Global Constraints

- **Zero behavior change.** Gate: ~1,711 unit + 109 e2e + `tsc --noEmit` + `pnpm lint`, all green. No new product tests; no test-logic changes except the two specifier tweaks noted below.
- **`@savig/editor-state` is framework-neutral:** deps `@savig/engine` + `@savig/interaction` + `zustand` only. NO react, NO `apps/**` imports (verified: the store sources already import only those). Acyclic: `engine ← interaction ← editor-state`.
- **Single store.** Only `store.ts:86` creates a store repo-wide. After the swap it is a vanilla `createStore` — the React hook binds to it; it is NOT re-created in the app.
- **`useEditor` preserves the bound-hook contract:** callable as `useEditor(selector)` and `useEditor()` (whole state), and carries `getState`/`setState`/`subscribe`/`getInitialState` (2,927 call sites depend on these). Achieved via `Object.assign(hook, store)` — mirrors what zustand's own `create()` returns.
- Use `git mv`. No per-package tsconfig/composite. Declare deps per package (W7).

---

### Task 1: Create `@savig/editor-state`, swap to vanilla store, add React shims

**Files:**
- Create: `packages/editor-state/package.json`, `packages/editor-state/src/index.ts`
- Move: `apps/react/src/ui/store/{store.ts, store-internals.ts, selectors.ts, store-internals.test.ts, selectors.test.ts}` and `slices/*` → `packages/editor-state/src/`
- Edit (in package): `store.ts` (create→createStore), `selectors.test.ts` (one type-import specifier)
- Create (in app, as shims): `apps/react/src/ui/store/store.ts`, `apps/react/src/ui/store/selectors.ts`
- Keep in app: `apps/react/src/ui/store/store.test.ts`, `apps/react/src/ui/store/scenes.test.ts` (they test via `useEditor`)
- Modify: `tsconfig.json` paths, `vitest.config.ts` alias, `apps/react/vite.config.ts` alias; root `package.json` (add `zustand` where needed)

**Interfaces:**
- Produces: `@savig/editor-state` exporting `store: StoreApi<EditorState>`, all `select*` fns, and the `EditorState`/`Theme`/`ToolMode`/`Keyframe*`/`Toast` types. `apps/react` `useEditor` (bound hook + store methods).

- [ ] **Step 1: Move the neutral store sources into the package** (keep the two big behavior tests in the app):

```bash
mkdir -p packages/editor-state/src/slices
git mv apps/react/src/ui/store/store.ts            packages/editor-state/src/store.ts
git mv apps/react/src/ui/store/store-internals.ts  packages/editor-state/src/store-internals.ts
git mv apps/react/src/ui/store/store-internals.test.ts packages/editor-state/src/store-internals.test.ts
git mv apps/react/src/ui/store/selectors.ts        packages/editor-state/src/selectors.ts
git mv apps/react/src/ui/store/selectors.test.ts   packages/editor-state/src/selectors.test.ts
git mv apps/react/src/ui/store/slices/groupSymbolSlice.ts    packages/editor-state/src/slices/groupSymbolSlice.ts
git mv apps/react/src/ui/store/slices/scenesSlice.ts         packages/editor-state/src/slices/scenesSlice.ts
git mv apps/react/src/ui/store/slices/transportPrefsSlice.ts packages/editor-state/src/slices/transportPrefsSlice.ts
```
`apps/react/src/ui/store/` now contains only `store.test.ts` and `scenes.test.ts` (kept). You will re-create `store.ts` + `selectors.ts` as shims in Step 5.

- [ ] **Step 2: Swap the moved `packages/editor-state/src/store.ts` to a vanilla store.** Make exactly these edits (leave the entire `(set, get) => ({ ... })` object body — all ~1400 lines — untouched):
  - Line 1: `import { create } from 'zustand';` → `import { createStore } from 'zustand/vanilla';`
  - The export at ~L86: `export const useEditor = create<EditorState>((set, get) => ({` → `export const store = createStore<EditorState>((set, get) => ({`
  - Keep the `export type { ... } from './store-internals';` re-export line as-is.
  - Nothing else changes (the slices are still invoked `...createGroupSymbolSlice(set, get)` etc.).

- [ ] **Step 3: Fix `packages/editor-state/src/selectors.test.ts`'s one intra-dir type import.** It imports `type { EditorState } from './store'`. Since the package's `store.ts` no longer exports `EditorState` under that name path cleanly (it's a type re-export), point it at the source: change `from './store'` → `from './store-internals'` (where `EditorState` is defined). Value/behavior unchanged.

- [ ] **Step 4: Create the package barrel `packages/editor-state/src/index.ts`:**

```ts
export { store } from './store';
export * from './selectors';
export type {
  EditorState, Theme, ToolMode, KeyframeRef, ShapeKeyframeRef, ColorKeyframeRef,
  GradientKeyframeRef, DashKeyframeRef, ProgressKeyframeRef, RemapKeyframeRef,
  KeyframeClip, Toast,
} from './store-internals';
```
(These are the exact type names `store.ts` previously re-exported. If `tsc` reports a name not exported by `store-internals`, adjust to match its actual exports — the set must equal what the old `store.ts:71` re-exported.)

- [ ] **Step 5: Create `packages/editor-state/package.json`:**

```json
{
  "name": "@savig/editor-state",
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts", "./*": "./src/*.ts" },
  "dependencies": {
    "@savig/engine": "workspace:*",
    "@savig/interaction": "workspace:*",
    "zustand": "^5.0.14"
  }
}
```

- [ ] **Step 6: Create the React binding shim `apps/react/src/ui/store/store.ts`:**

```ts
import { useStore, type StoreApi, type UseBoundStore } from 'zustand';
import { store } from '@savig/editor-state';
import type { EditorState } from '@savig/editor-state';

// Bind the vanilla store to a React hook that ALSO carries the StoreApi methods
// (getState/setState/subscribe/getInitialState) — mirrors what zustand's create()
// returns, so all `useEditor(...)` and `useEditor.getState()` call sites are unchanged.
export const useEditor = Object.assign(
  ((selector?: (s: EditorState) => unknown) =>
    selector ? useStore(store, selector) : useStore(store)) as UseBoundStore<StoreApi<EditorState>>,
  store,
);

// Preserve the type re-export barrel so `import type { ToolMode } from '../../store/store'` still works.
export type {
  EditorState, Theme, ToolMode, KeyframeRef, ShapeKeyframeRef, ColorKeyframeRef,
  GradientKeyframeRef, DashKeyframeRef, ProgressKeyframeRef, RemapKeyframeRef,
  KeyframeClip, Toast,
} from '@savig/editor-state';
```
If the exact `UseBoundStore<StoreApi<EditorState>>` cast produces a type error at a `useEditor(...)` call site, adjust the annotation until `tsc --noEmit` is clean AND every existing call form (`useEditor(sel)`, `useEditor()`, `useEditor.getState()`, `.setState()`, `.subscribe()`) type-checks — do not change the call sites.

- [ ] **Step 7: Create the selectors shim `apps/react/src/ui/store/selectors.ts`:**

```ts
export * from '@savig/editor-state';
```
(Re-exports every `select*` fn; consumers' `import { selectX } from '../store/selectors'` resolve unchanged. `useEditor` is NOT here — it's app-local in `./store`.)

- [ ] **Step 8: Add the `@savig/editor-state` alias to all three surfaces** (single entry each): `tsconfig.json` paths `"@savig/editor-state": ["packages/editor-state/src/index.ts"]`; `vitest.config.ts` alias `'@savig/editor-state': r('./packages/editor-state/src/index.ts')`; `apps/react/vite.config.ts` alias `'@savig/editor-state': r('../../packages/editor-state/src/index.ts')`.

- [ ] **Step 9: Ensure deps resolve.** `apps/react/package.json` already declares `zustand` (keep it — the shim uses `useStore`). Run `pnpm install`. If a moved package test needs jsdom, add `['packages/editor-state/src/**', 'jsdom']` to `environmentMatchGlobs` — determine empirically.

- [ ] **Step 10: Full gate — ALL must pass:**

Run: `pnpm typecheck && pnpm test && pnpm lint && pnpm e2e`
Expected: `tsc --noEmit` clean; ~1,711 unit passing (store.test.ts/scenes.test.ts run in the app via `useEditor`; store-internals/selectors tests run in the package); lint clean; 109 e2e passing.

- [ ] **Step 11: Commit.**

```bash
git add -A
git commit -m "refactor: extract @savig/editor-state (vanilla createStore + React useEditor shim)"
```

---

## Self-Review (against constraints + exploration)

- **Framework-neutrality:** all moved sources import only engine/interaction/zustand/siblings (verified) — package boundary holds. ✅
- **Single store / no self-reference:** only `store.ts` creates the store; no internal code references `useEditor` by name (verified), so vanilla `store` + React `useEditor` split is safe. ✅
- **Consumer preservation:** shims at `store/store.ts` (useEditor + type barrel) and `store/selectors.ts` (`export *`) keep all `../store/store` + `../store/selectors` imports unchanged; store-internals/slices were never imported externally. ✅
- **2,927 static call sites:** `Object.assign(hook, store)` carries `getState/setState/subscribe/getInitialState`. ✅
- **Placeholder scan:** the type lists in Steps 4/6 must match `store-internals`'s actual exports — instruction says adjust to match if tsc disagrees; not a placeholder (the exact 12 names are given, copied from the old `store.ts:71`). No TBDs.
- **Test placement:** the two large behavior tests stay in the app (test via `useEditor`, unchanged); the two pure tests move with their sources (selectors.test.ts gets one type-specifier fix). ✅
