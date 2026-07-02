# Framework-Agnostic Restructure — Design

**Date:** 2026-07-02
**Status:** Approved design (pending final spec review)
**Goal:** Reorganize Savig into a pnpm monorepo with framework-neutral packages and framework-specific apps, so the UI can be ported off React. Deliverable: the restructure **plus a thin Svelte 5 proof-of-concept app** that does full canvas editing, proving the boundaries hold.

---

## 1. Context — why this is ~80% done already

Savig is already driven by **three non-React consumers** (the MCP server, the headless `core` authoring API, and the standalone `runtime` player) against one pure `engine` model. Audit findings:

- **~16.7k LOC of model/logic is already React-free.** `core`, `engine`, `services`, `runtime`, `mcp`, `types` have **0** React/Zustand imports.
- **React + Zustand are confined entirely to `src/ui/`** — 22 files import React; only 8 use `useState`, 8 use `useEffect` (state lives in the store, not components).
- The `runtime/` player renders SVG frames with **no React** — living proof the model→render path is portable.
- **31 pure `.ts` files** (snapping, align, pathEdit, scaleSnap, gridSnap, spacingGuides, rotateHandle, hit-testing, coordinate math, drawGeometry, buildDefs, resize/scale handles) currently live *inside* `ui/components/Stage/` but import no React — framework-neutral interaction math squatting in the UI tree.
- The Zustand store (`ui/store`, ~8k LOC incl. tests) is thin **orchestration**: actions `get()` → call an `engine` pure function → `set()`. Business logic already lives in `engine`, not the store.

The React editor is one client among several, not the source of truth. That precondition for a clean port is already met.

**No hidden cross-cutting state (verified in review).** The store uses **no Zustand middleware** (no persist/immer/devtools/subscribeWithSelector — the vanilla swap really is one seam). `ui/` has **no React Context, no `createPortal`** anywhere. Toast state lives **in the store** (`transportPrefsSlice`), not a provider. Net: there is zero hidden cross-cutting UI state — everything a second framework must observe is already in the neutral store. This materially lowers the risk of the port.

**Decisions locked during brainstorming:**
- Target: framework-agnostic core, swappable UI (not a single specific framework).
- Scope: restructure **+ a thin second-framework app** to validate boundaries.
- PoC framework: **Svelte 5** (runes / no-VDOM — the harshest test of the store boundary).
- PoC features: load + play + render + selection + inspector + **full canvas editing (drag/snap)**.
- UI decoupling level: **L1 view-models everywhere + selective L2 headless controllers** for the genuinely stateful widgets.

---

## 2. Architecture — the layer rule

The core architectural rule (derived from a cycle the naïve design would have introduced):

> **Pure math sits *below* the store. Stateful orchestration sits *above* it.**

`interaction` (snap/align/hit-test — no store) is a dependency of `editor-state`. Controllers *call* store actions, so they live in a layer *above* the store (`ui-core`) and receive the store **by injection** — they never import it. This keeps the graph strictly one-directional and acyclic:

```
                         ┌──────────┐
                         │  engine  │   model + all math (0 deps)
                         └────┬─────┘
        ┌───────────┬─────────┼──────────┬─────────────┐
        ▼           ▼         ▼          ▼             ▼
  ┌───────────┐ ┌──────┐ ┌────────┐ ┌────────┐  ┌──────────────┐
  │interaction│ │ core │ │services│ │runtime │  │    types     │
  │(pure math)│ │(+node)│ └───┬────┘ └────────┘  └──────────────┘
  └─────┬─────┘ └──┬───┘      │
        │          │          ▼
        │          │       ┌──────┐
        │          └──────▶│ mcp  │
        │                  └──────┘
        ▼
  ┌──────────────┐   deps: engine, interaction
  │ editor-state │   (vanilla Zustand store)
  └──────┬───────┘
         ▼
  ┌──────────────┐   deps: editor-state, interaction, engine
  │   ui-core    │   ├─ viewmodels/   (L1 presenters)
  │              │   └─ controllers/  (L2 headless state machines + playback/keymap/autosave)
  └──────┬───────┘
         ▼
  ┌───────────────────────────────┐
  │  apps/react     apps/svelte    │  deps: ui-core, editor-state, engine, services, core (browser-safe)
  └───────────────────────────────┘
```

> **Note — one edge the ASCII omits for clarity:** `services → runtime`. `services/export/exportProject.ts` imports `runtimeSource.generated.ts` (the `RUNTIME_JS` constant) from the runtime package to embed the player in exported HTML. This is a build-order dependency (runtime's generated bundle must exist before services builds — see W4), not an import cycle. The graph is still acyclic.

---

## 3. Packages — what moves, what's new

| Package | Source | Change | Deps |
|---|---|---|---|
| `@savig/engine` | `src/engine` | **move only** | — |
| `@savig/interaction` | **new** — pure files from `ui/components/Stage/*.ts` (snapping, align, pathEdit, scaleSnap, gridSnap, spacingGuides, rotateHandle, hit-test, stageCoords, drawGeometry, buildDefs, resizeHandles, scaleHandles) | move pure math (NO store) | engine |
| `@savig/core` | `src/core` | move + **subpath split** (see W3) | engine |
| `@savig/services` | `src/services` | move only | engine, runtime (generated bundle) |
| `@savig/runtime` | `src/runtime` | move + relocate build script (see W4) | engine |
| `@savig/mcp` | `src/mcp` | move only | core, engine, services |
| `src/types/gifenc.d.ts` | `src/types` | move into `@savig/core/node` (W3) — no separate package | — |
| `@savig/editor-state` | `ui/store` (store, store-internals, slices, selectors) | move + swap `create`→`createStore` (see W1) | engine, interaction |
| `@savig/ui-core` | **new** — L1 presenters extracted from panel `.tsx`; L2 controllers extracted from the ~10 `use*` interaction hooks + playback/keyboard/autosave | extract neutral UI logic | editor-state, interaction, engine |
| `packages/theme` | design tokens extracted from `ui/theme` + `*.module.css` | new — CSS custom properties only | — |
| `apps/react` | `ui/components`, `ui/hooks`, `ui/playback`, `ui/App`, `main.tsx`, `index.html` | rebind to packages | all above |
| `apps/svelte` | **new** | thin PoC | ui-core, editor-state, engine, services, core |

The move-only packages carry their existing `.test.ts` files unchanged — the ~1,700 tests keep passing after a path-alias update.

---

## 4. State layer — one vanilla store, two bindings

`store.ts` changes exactly one seam: `create` (React-bound) → `createStore` from `zustand/vanilla`. The ~2,100 LOC of engine-delegating orchestration, selectors, and slices are untouched.

- **React** (`apps/react`): a shim that mirrors what Zustand's own `create` does — a hook that is *also* the store:
  ```ts
  const useEditor = ((sel) => useStore(store, sel)) as UseBoundStore;
  Object.assign(useEditor, store); // .getState/.setState/.subscribe/.getInitialState
  ```
  This preserves **all 2,927 static-method call sites** (`useEditor.getState()` etc.) across 41 files with zero edits. (See **W1**.)
- **Svelte** (`apps/svelte`): a ~15-line adapter wraps `store.subscribe` in a `$state` rune inside a `$effect`, exposing selector ergonomics; actions are called directly off `store.getState()`.

Selectors (`selectActiveObjects`, `selectEditProject`, …) are already pure and shared by both.

---

## 5. View-model layer (L1) — presenters for every panel

Per panel: a pure `state → ViewModel` (display descriptor) + an `intents` factory (thin action wrappers). Lives in `@savig/ui-core/viewmodels`.

```ts
// @savig/ui-core/viewmodels/inspector.ts — framework-neutral
export function inspectorViewModel(s: EditorState): InspectorVM {
  const sel = selectActiveObjects(s);
  return {
    kind: sel.length === 0 ? 'empty' : sel.length > 1 ? 'multi' : 'single',
    canBool: /* eligibleForBool logic moved out of Inspector.tsx */,
    canCreateSymbol: /* … */,
    sampled: sel.length === 1 ? sampleObject(sel[0], s.time) : undefined,
    correspondenceSummary: /* … */,
    // formatted numbers, dropdown option lists, enabled flags
  };
}
export const inspectorIntents = (store) => ({
  setFill: (c) => store.getState().setPaint('fill', c),
  booleanOp: (op) => store.getState().booleanOp(op),
});
```

**The test for "view" vs "presentation logic":** if a line would be identical in Svelte or Vue, it's not view — it's logic squatting in the component. In `Inspector.tsx` (992 LOC), roughly half is squatting logic (`correspondenceSummary`, `round`, `someGrouped`, `movableCount`, `eligibleForBool`, `canCreateSymbol`, `hasVectorLeaf`, `sampleObject(obj, time)`) → becomes the VM. Each framework's Inspector then only renders `vm` and calls `intents`.

---

## 6. Headless controllers (L2) — the stateful widgets

Widgets with genuine interaction state get framework-neutral controllers (state machine + event entry points), in `@savig/ui-core/controllers`. **~13 controllers, not 3** (corrected during review):

**Interaction (10):** object-drag, scale-drag, rotate-drag, marquee-select, pan-zoom, draw-tool, node-drag, gradient-drag, brush-tool, path-tools.
**App-level (3):** playback (rAF loop; `createAudioTransport`/`applyFrame` are already neutral), keymap (key→intent table + dispatch), autosave (timer + persistence).

Contract for every controller:
- **Store by injection, never import** (see **W2**): `createObjectDragController({ getState, setState })` or a passed store handle.
- **No DOM access** (see **W5**): the controller returns a *preview descriptor* (e.g. a ghost transform); the app applies it its own way (React ref/`setAttribute`, Svelte `bind:this`). The current hooks apply previews via direct `setAttribute` for performance — extraction must convert that to returned data + a framework-supplied `applyPreview` callback.
- **Coordinates injected:** the app supplies a client→stage-space transform (from `stageCoords.ts`, which moves to `@savig/interaction`); `begin(ptr)/move(ptr)/end()` take stage-space points.

Example: `objectDragController` internally builds the snap-target context (logic currently inline at `Stage.tsx:634–720`) and applies snapped transforms via injected store actions.

---

## 7. Stage render boundary — a neutral scene descriptor

Instead of each framework hand-mapping engine objects to SVG elements, a pure `buildStageScene(project, view, selection) → StageScene` produces a **draw list**: `{ items: DrawItem[], overlays: OverlayItem[] }`, each item `{ id, kind: 'rect'|'path'|…, attrs, interactive }` plus chrome (selection outlines, handles, guides, onion ghosts). Fed by the existing pure helpers (`drawGeometry.ts`, `buildDefs.ts`, `resize/scaleHandles.ts`) now in `@savig/interaction`. Each framework maps the descriptor to its own SVG elements in one small loop and attaches handlers that call the L2 controllers. *What to paint* (including chrome) is neutral; only element creation is per-framework.

**Hard constraint (see R2):** the descriptor MUST carry `data-savig-object` attributes, `aria-label`s, and testids identically across frameworks — the runtime/export/thumbnail paths depend on `data-savig-object`, and identical attributes let the **same Playwright e2e specs run against both apps**.

---

## 8. Cross-cutting constraints (from the design review)

### W1 — Store swap is 2,927 call sites, not one line
`useEditor.getState/.setState/.subscribe` are called 2,927× across 41 files. The React shim must `Object.assign(useEditor, store)` so the hook carries the static methods (§4). Otherwise step 3 turns red.

### W2 — Controllers must not import the store (cycle avoidance)
10 `use*Drag`/tool hooks currently `import { useEditor }`. If controllers imported the store while `editor-state` depends on `interaction`, that's a cycle. Controllers live in `ui-core` (above the store) and take the store by injection. Direction stays `engine ← interaction ← editor-state ← ui-core ← apps`.

### W3 — `@savig/core` pulls a native binary into the browser
Verified: **exactly two files** — `core/render.ts` and `core/gif.ts` — carry the node-only edges (`@resvg/resvg-js` native addon, `gifenc`, and imports of `services/export/renderDocument` + `runtime/frame`). The other 10 core modules (build, camera, describe, dsl, macros, scenes, templates, text, validate, ids) import **engine only** — genuinely browser-safe. Subpath exports:
- `@savig/core` (browser-safe: builders, DSL, describe/validate, templates, macros, camera) → **deps: engine only**.
- `@savig/core/node` (`render.ts` + `gif.ts`) → deps: engine, services, runtime, `@resvg/resvg-js`, `gifenc`; the `gifenc.d.ts` ambient types (`src/types`) move here, not into engine.

`core/index.ts` currently re-exports render/gif at lines 10–11 — the split moves those two exports to the `/node` entry. Browser apps import only the browser-safe entry and never bundle resvg. One test-only edge: `core/camera.test.ts` imports `renderSvgDocument` from services — it needs `@savig/services` as a **devDependency** of the core package (or the test moves to the node side).

### W4 — Runtime bundle is a committed generated artifact with build-order dependency
`scripts/build-runtime.mjs` esbuilds `runtime/index.ts` → `runtime/runtimeSource.generated.ts`, imported by `services/export/exportProject.ts` to embed the player in exported HTML. In the monorepo: relocate the script to the runtime package (entry `packages/runtime/src/index.ts`, output into the package), keep the generated file committed, and wire `build:runtime` into workspace build order so `@savig/services` builds after it.

### W5 — Imperative DOM previews are a hidden React coupling
Drag hooks apply live previews via direct `setAttribute` on SVG nodes (perf path, bypassing store state). Controllers must return preview descriptors, not touch the DOM (§6).

### R1 — Design tokens shared; component styles are not
14 `.module.css` files don't port (CSS Modules is a Vite/React convention; Svelte uses scoped `<style>`). Extract color/spacing/typography **CSS custom properties** into `packages/theme` (`:root` vars) consumed by both apps. Component-level styling is rewritten per framework — accepted; it is genuinely view.

### R2 — Identical render attributes across frameworks (HARD requirement)
Promoted from recommendation: `data-savig-object`, `aria-label`s, and testids must match across apps (§7) — required for runtime/export correctness AND to make it *possible* to reuse the Playwright e2e suite as the boundary proof. R2 is the capability; **R5 defines which specs must actually pass** against both apps.

### W6 — "Fix path aliases" is a ~180-site cross-package codemod
There are **168 relative `../engine` imports + 12 to core/services/runtime/mcp**, and 44 ui files import the store. Every *cross-package* edge changes (`../../engine` → `@savig/engine`, etc.); intra-package imports stay relative. Do it as an **automated rewrite** (ts-morph/jscodeshift or scoped sed), gated by `tsc --noEmit` + full test suite — not by hand.

### W7 — pnpm phantom-dependency strictness
pnpm won't let a package import a dep it doesn't declare (no npm/yarn-style hoisting). Each package's `package.json` must declare its own direct deps (`polygon-clipping`, `fflate`, `@resvg/resvg-js`, `gifenc`, `zustand`, `@modelcontextprotocol/sdk`, …) — derive the list from actual imports during the move, or builds break.

**Slice 1 execution note — the root is a legitimate test-tooling consumer.** After pruning, root `dependencies` is `{}`, but three deps remain in root **devDependencies** because the repo-root test/e2e tooling genuinely imports them: `react` + `react-dom` (the central root-run `vitest.config.ts` transforms/runs the app's `.tsx` tests via `@vitejs/plugin-react`, whose forced `resolve.dedupe:['react','react-dom']` resolves those bare specifiers only from root `node_modules`), and `fflate` (≈20 `e2e/**` specs `import {unzipSync} from 'fflate'` and run under Playwright from the repo root, outside any workspace-package context). `apps/react` and `@savig/services` keep their own runtime copies. The other 5 pruned deps (`zustand`, `@resvg/resvg-js`, `gifenc`, `polygon-clipping`, `@modelcontextprotocol/sdk`) are NOT root-tooling consumers and stay fully pruned. This is honest declaration, not a hoist hack.

### R5 — Scope shared-e2e parity to a tagged subset (not all 68 specs)
The e2e suite is **68 spec files, ~38 distinct testids, ~21 role/label queries**, covering the *whole* editor (symbols library, scenes, MCP, …). The Svelte PoC is "full canvas editing," not the whole app. Tag the specs that map to the PoC's feature set (e.g. `@portable`) and require only those to pass against both apps. Requiring all 68 against a thin PoC is a category error.

### R6 — Formalize a cross-app "test contract"
The e2e suite depends on exactly one app-set global: **`window.savigSeek`**. Both apps must expose it identically (plus the tagged subset's testids/aria). Recommendation: take the already-deferred refactor (project memory) — replace the ambient `window.savigSeek` with a `create()`/playback that **returns a typed `{ seek }` handle**; each app wires it to `window` only in test builds. Makes the contract an interface both apps implement, not a global.

### R7 — Consume package TS source in app dev; build only publishable artifacts
Point `@savig/*` aliases at each package's `src` so Vite dev gives instant HMR with no per-package build. Reserve real builds for the two standalone artifacts: the **MCP bin** and the **runtime bundle** (W4). Orchestrate with `pnpm -r --filter`; add Turbo/Nx only if build caching becomes a pain.

### R8 — Type-checking: single central tsconfig now, project references deferred
**Revised during planning.** TS project references require `composite: true` + declaration emit, which **conflicts with the repo's existing `allowImportingTsExtensions: true` + `noEmit: true`**. Since dev consumes source (R7) and Vite handles bundling, per-package build graphs aren't needed. Slice 1 keeps **one central root `tsconfig.json`** with `paths` mapping `@savig/*` → `packages/*/src` and a broad `include`, type-checked via `tsc --noEmit`. Verified there are **zero `.ts`-extension imports** in source, so a later switch to `composite`/references (dropping `allowImportingTsExtensions`) is possible if build performance ever demands it — but it's a deferred optimization, not a Slice 1 requirement. The §2 layer rule still governs correctness (it's what makes a future reference graph acyclic).

**Deferred follow-up (whole-branch review, Minor):** deep-subpath aliases are enumerated explicitly in three surfaces (`tsconfig.json` paths, `vitest.config.ts`, `apps/react/vite.config.ts`) while package.json `exports` uses a `./*` wildcard. Current state is fully coherent (exactly six deep specifiers exist, all enumerated in all three). A *future* new engine deep import would resolve via node/wildcard but fail tsc/Vite until added to all three — a latent maintainability footgun. Not fixed in Slice 1 (regex/prefix aliases in Vite risk destabilizing the green state); revisit when a later slice touches these surfaces (e.g. `@savig/engine/*` prefix maps).

### R3 — Per-package Vitest environment
`engine`/`core`/`interaction` → `node`; `services`/`editor-state`/`ui-core` → `jsdom` (+ `fake-indexeddb` for persistence); apps → `jsdom` + framework testing-library. Configure per package on move or tests fail.

### R4 — Deliver as slices with green gates
Multi-week effort. The §9 sequence is slice-shaped; each step is its own branch/PR with the full unit + e2e suite as the gate (matches the established M4/M5 workflow).

---

## 9. Migration sequence (tests green at every step)

1. **Workspace scaffold + move-only packages.** `pnpm-workspace.yaml` (`packages/*`, `apps/*`), per-package `package.json` (`workspace:*` deps), and one **central root `tsconfig.json`** with `paths` (no per-package project references — R8). Move engine, core (with node subpath + `gifenc.d.ts`, W3), services, runtime (relocate build script, W4), mcp, and relocate `src/ui` → `apps/react` (pure move + import rewrite; store stays React-bound `create` — the vanilla swap is deferred to step 3); declare each package's own deps (W7); **run the automated cross-package import codemod** (W6). **Gate: `tsc --noEmit` + full unit + e2e suite green.** (Detailed in `docs/superpowers/plans/2026-07-02-restructure-slice1-workspace-packages.md`.)
2. **Extract `@savig/interaction`.** Move the pure Stage `.ts` math files (no store). **Gate: green.**
3. **Vanilla-store swap → `@savig/editor-state`.** `createStore` + React `Object.assign` shim (W1) so `apps/react` is untouched. **Gate: unit + e2e green.**
4. **Extract `@savig/ui-core/viewmodels`** panel-by-panel; refactor React panels to consume them (behavior-preserving). **Gate: unit + e2e green.**
5. **Extract `@savig/ui-core/controllers`** — the ~13 controllers, store-by-injection + no-DOM previews (W2/W5); refactor React Stage/hooks/playback/keyboard/autosave to use them. Extract `packages/theme` tokens (R1). **Gate: unit + e2e green.**
6. **Build `apps/svelte`** incrementally: store adapter → scene descriptor render (R2 attributes) → panels (VMs) → controllers → playback; implement the cross-app test contract (R6: `window.savigSeek`/typed seek handle + the tagged testid/aria set). **Gate: the `@portable`-tagged Playwright subset (R5) passes against both apps.**

Steps 1–5 leave a fully working React app; the Svelte app is purely additive.

---

## 10. Tooling & testing

- **Workspace:** `pnpm-workspace.yaml`; each package/app owns its `package.json`; type-checking is centralized in one root `tsconfig.json` with `paths` (`tsc --noEmit`), not per-package project references (R8).
- **Build:** packages type-checked via project refs; apps built by their own Vite config (`@vitejs/plugin-react` / `@sveltejs/vite-plugin-svelte`). `build:runtime` runs in the runtime package before services (W4).
- **Tests:** Vitest per package (unit tests travel with code; env per R3); Playwright e2e at root, gaining a second project targeting the Svelte app to run the **same** editing scenarios against both UIs (R2).

---

## 11. Open questions (reversible)

- **`ui-core` as one package vs split `viewmodels`/`controllers`.** Recommendation: **one package, two subpath exports** (`@savig/ui-core/viewmodels`, `/controllers`) — boundary visible without package overhead. Reversible.
- **`types` fold-in — RESOLVED.** `src/types` is a single file, `gifenc.d.ts` (ambient module decl for `gifenc`). Per W3 it belongs with `@savig/core/node` (where `gif.ts` imports `gifenc`), not `@savig/engine`. No separate `types` package.

---

## 12. Risks

- **Svelte SVG reactivity at scale** — large scenes re-rendering; mitigate with keyed `each` over the draw list + fine-grained runes.
- **Controller ↔ framework coordinate conversion** — each app must supply an accurate client→stage transform; the React one (`stageCoords.ts`) moves to `@savig/interaction`.
- **Generated-artifact drift** — `runtimeSource.generated.ts` must be regenerated + committed when runtime changes; enforce via build order and a CI check.
- **Codemod correctness (W6)** — a ~180-site automated import rewrite can silently mis-map an edge; the `tsc --noEmit` + full-suite gate after step 1 is the guard. Land the codemod as its own commit so a bad rewrite is trivially revertible.
- **Test-contract drift (R6)** — if the React app's testids/aria/`savigSeek` change without updating the Svelte app, the `@portable` subset silently diverges; keep the contract in one documented module both apps import.
