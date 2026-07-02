# Framework-Agnostic Restructure — Slice 1: Workspace + Move-Only Packages

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the single-package Savig repo into a pnpm workspace, extracting the React-free logic directories (`engine`, `core`, `services`, `runtime`, `mcp`) into `@savig/*` packages and relocating `src/ui` → `apps/react`, with **zero behavior change** and the full unit + e2e suite green at every step.

**Architecture:** Alias-first. Introduce `@savig/*` TypeScript/Vite/Vitest path aliases pointing at the *current* `src/*` dirs, codemod all cross-directory imports to those aliases while everything still lives in `src/`, then physically move each directory one at a time — repointing only its alias target — so resolution never breaks. Each package gets its own `package.json` (deps declared per W7); type-checking stays **centralized in one root `tsconfig.json` with `paths`** — project references/`composite` are deferred (they conflict with the repo's existing `allowImportingTsExtensions`+`noEmit`; see R8 note). `@savig/core` splits into a browser-safe main entry (`→ engine` only) and a `@savig/core/node` subpath (`render.ts` + `gif.ts`, the only files touching `@resvg/resvg-js`/`gifenc`/`services`/`runtime`).

**Tech Stack:** pnpm workspaces, TypeScript 5.5 (single central tsconfig + `paths`), Vite 5, Vitest 2, Playwright, esbuild (runtime bundle), ts-morph (one-shot codemod).

## Global Constraints

- **Zero behavior change.** This slice is a pure refactor. The existing unit tests (~1,700) and e2e specs (68) are the gate; no test logic changes except import specifiers and config globs. Never weaken or skip a test to make a move pass.
- **Acyclic dependency graph (verified):** `engine`(0 deps) ← `runtime` ← `services` ← `core/node`; `core`(browser) ← `engine` only; `mcp` ← `core`,`engine`,`services`; `apps/react` ← all. `services → runtime` is a build-order edge (imports the generated `RUNTIME_JS`). No cycles.
- **Node/browser dep separation:** `@resvg/resvg-js` (native) + `gifenc` live only in `@savig/core/node`. Browser code (apps) imports `@savig/core` (browser-safe) — never `/node`.
- **pnpm strictness (W7):** every package declares its own direct deps; no reliance on root hoisting.
- **Dev consumes source (R7):** aliases resolve `@savig/*` to each package's `src/` for Vite/Vitest; one root `tsconfig.json` (with `paths` + a broad `include`) type-checks the whole tree via `tsc --noEmit`. No per-package dist build in this slice except the runtime bundle.
- **TypeScript strict** stays on, with the repo's existing options preserved verbatim (incl. `allowImportingTsExtensions`, `noEmit`). `tsc --noEmit` must be clean at each gate.
- **Commit after every task.** End messages with the repo's `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

## Roadmap (this plan = Slice 1 only)

Each slice is its own plan, written just-in-time once the prior lands (signatures for later slices don't exist until earlier moves complete):

- **Slice 1 (this doc):** workspace + move-only packages + import codemod + `apps/react` relocation. Store stays React-bound.
- **Slice 2:** extract `@savig/interaction` (pure Stage `.ts` math, no store).
- **Slice 3:** vanilla-store swap → `@savig/editor-state` + React `Object.assign` shim (W1); app untouched.
- **Slice 4:** extract `@savig/ui-core/viewmodels` (L1); refactor React panels.
- **Slice 5:** extract `@savig/ui-core/controllers` (L2, ~13) + `packages/theme` tokens; refactor React Stage/hooks/playback.
- **Slice 6:** build `apps/svelte` + cross-app test contract (R6) + `@portable` e2e subset (R5).

---

## File Structure (end state of Slice 1)

```
pnpm-workspace.yaml            # packages/*, apps/*
package.json                   # root: shared devDeps + orchestration scripts only
tsconfig.json                  # single central type-check config: existing options + paths + broad include (packages/*/src, apps/*/src). No per-package tsconfig / composite in Slice 1.
vitest.config.ts               # single central test config (aliases + per-dir envs, R3) — renamed from vite.config.ts in Task 9
vitest.setup.ts                # shared jsdom setup (jest-dom + fake-indexeddb + PointerEvent polyfill) — was src/test-setup.ts
scripts/codemod-imports.mjs    # one-shot ts-morph cross-package import rewrite
packages/
  engine/     { package.json, src/** (was src/engine) }
  runtime/    { package.json, src/** (was src/runtime), scripts/build-runtime.mjs }
  services/   { package.json, src/** (was src/services) }
  core/        { package.json (exports: '.' + './node'),
                 src/** (was src/core), src/node/gifenc.d.ts (was src/types) }
  mcp/        { package.json, src/** (was src/mcp) }
apps/
  react/      { package.json, vite.config.ts, index.html,
                 src/** (was src/ui), src/main.tsx, src/vite-env.d.ts }
                 # test-setup.ts moves to root vitest.setup.ts (shared)
```

---

### Task 1: Introduce `@savig/*` path aliases (no file moves)

Establish the alias seam first so later moves are invisible to importers.

**Files:**
- Modify: `tsconfig.json` (add `baseUrl` + `paths`)
- Modify: `vite.config.ts` (add `resolve.alias` + Vitest `alias`)

**Interfaces:**
- Produces: alias specifiers `@savig/engine`, `@savig/core`, `@savig/core/node`, `@savig/services`, `@savig/runtime`, `@savig/mcp` resolving to the current `src/*` dirs.

- [ ] **Step 1: Add TS path aliases.** In `tsconfig.json`, inside `compilerOptions`, add:

```jsonc
"baseUrl": ".",
"paths": {
  "@savig/engine": ["src/engine/index.ts"],
  "@savig/core": ["src/core/index.ts"],
  "@savig/core/node": ["src/core/render.ts"],
  "@savig/services": ["src/services/index.ts"],
  "@savig/runtime": ["src/runtime/index.ts"],
  "@savig/mcp": ["src/mcp/server.ts"]
}
```

(`@savig/core/node` points at `render.ts`; it re-exports `gif.ts` — added in Task 7.)

- [ ] **Step 2: Add Vite + Vitest aliases.** In `vite.config.ts`, add a shared alias array and wire it into both `resolve` and `test`:

```ts
import { fileURLToPath } from 'node:url';
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const alias = {
  '@savig/engine': r('./src/engine/index.ts'),
  '@savig/core/node': r('./src/core/render.ts'),
  '@savig/core': r('./src/core/index.ts'),
  '@savig/services': r('./src/services/index.ts'),
  '@savig/runtime': r('./src/runtime/index.ts'),
  '@savig/mcp': r('./src/mcp/server.ts'),
};
// in defineConfig: resolve: { alias }, and test: { ...existing, alias }
```

(Order matters: `@savig/core/node` before `@savig/core` so the longer key wins.)

- [ ] **Step 3: Verify nothing broke.** Aliases are additive; no imports use them yet.

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean; all existing unit tests PASS (unchanged count).

- [ ] **Step 4: Commit.**

```bash
git add tsconfig.json vite.config.ts
git commit -m "build: add @savig/* path aliases (resolve to src/, no moves yet)"
```

---

### Task 2: Codemod cross-package imports to `@savig/*` (W6)

Rewrite every import that crosses a top-level `src/` subdir boundary (`engine`/`core`/`services`/`runtime`/`mcp`) to its `@savig/*` alias. Intra-package relative imports are left untouched.

**Files:**
- Create: `scripts/codemod-imports.mjs`
- Modify: ~180 import sites across `src/**` (mechanical)

**Interfaces:**
- Consumes: aliases from Task 1.
- Produces: all cross-package imports expressed as `@savig/*` specifiers.

- [ ] **Step 1: Install ts-morph as a dev dependency.**

Run: `pnpm add -D ts-morph`
Expected: added to root `devDependencies`.

- [ ] **Step 2: Write the codemod.** Create `scripts/codemod-imports.mjs`:

```js
import { Project } from 'ts-morph';
import path from 'node:path';

const PKGS = ['engine', 'core', 'services', 'runtime', 'mcp'];
const SRC = path.resolve('src');
// map an absolute file path to its top-level src package, or null
const pkgOf = (abs) => {
  const rel = path.relative(SRC, abs);
  if (rel.startsWith('..')) return null;
  const top = rel.split(path.sep)[0];
  return PKGS.includes(top) ? top : null;
};

const project = new Project({ tsConfigFilePath: 'tsconfig.json' });
let changed = 0;
for (const sf of project.getSourceFiles('src/**/*.{ts,tsx}')) {
  const fromPkg = pkgOf(sf.getFilePath()); // package the importer lives in (or null = ui)
  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    if (!spec.startsWith('.')) continue; // only relative imports
    const abs = path.resolve(path.dirname(sf.getFilePath()), spec);
    const toPkg = pkgOf(abs);
    if (!toPkg || toPkg === fromPkg) continue; // not cross-package
    // sub-path within the target package (e.g. runtime/runtimeSource.generated)
    const targetTop = path.join(SRC, toPkg);
    const sub = path.relative(targetTop, abs).replace(/\\/g, '/');
    const isIndex = sub === '' || sub === 'index' || sub === 'index.ts';
    const newSpec = isIndex ? `@savig/${toPkg}` : `@savig/${toPkg}/${sub.replace(/\.tsx?$/, '')}`;
    imp.setModuleSpecifier(newSpec);
    changed++;
  }
}
await project.save();
console.log(`Rewrote ${changed} cross-package imports.`);
```

- [ ] **Step 3: Run the codemod.**

Run: `node scripts/codemod-imports.mjs`
Expected: prints `Rewrote ~180 cross-package imports.` (≈168 engine + ≈12 others).

- [ ] **Step 4: Verify green (aliases resolve to src, so behavior is identical).**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean; all unit tests PASS, same count as Task 1.

- [ ] **Step 5: Handle the one deep import.** `@savig/runtime/runtimeSource.generated` and `@savig/core/node` sub-imports must resolve. Confirm `src/services/export/exportProject.ts` now imports `@savig/runtime/runtimeSource.generated` and add that to the alias map if the generated file isn't the index:

```ts
// vite.config.ts alias — add:
'@savig/runtime/runtimeSource.generated': r('./src/runtime/runtimeSource.generated.ts'),
// tsconfig paths — add:
"@savig/runtime/runtimeSource.generated": ["src/runtime/runtimeSource.generated.ts"],
```

Run: `pnpm typecheck && pnpm test` → PASS.

- [ ] **Step 6: Commit (isolated so a bad rewrite is trivially revertible — see spec Risks).**

```bash
git add -A
git commit -m "refactor: codemod cross-package imports to @savig/* specifiers (W6)"
```

---

### Task 3: Scaffold the pnpm workspace

**Files:**
- Create: `pnpm-workspace.yaml`
- Modify: `package.json` (scripts)
- Modify: `tsconfig.json` (broaden `include` to cover future package/app locations)

**Interfaces:**
- Produces: `packages/` and `apps/` as workspace roots. Type-checking stays centralized in the existing root `tsconfig.json` (no per-package tsconfig, no `composite`). Test config stays in the single root `vite.config.ts` for now; it is renamed to `vitest.config.ts` in Task 9 once the dev server moves to the app.

- [ ] **Step 1: Create `pnpm-workspace.yaml`:**

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

- [ ] **Step 2: Broaden the root `tsconfig.json` `include`** so files are still type-checked after they move under `packages/*/src` and `apps/*/src`. Leave every existing `compilerOptions` value untouched (including `allowImportingTsExtensions`, `noEmit`, `paths` from Task 1). Change only `include`:

```jsonc
"include": ["src", "packages", "apps", "vite.config.ts", "vitest.config.ts"]
```

(No `composite`/`declaration`/references — those conflict with the repo's `allowImportingTsExtensions`+`noEmit` and are unnecessary because dev consumes source, R7/R8.)

- [ ] **Step 3: Add root orchestration scripts** to `package.json` (keep the existing `typecheck: "tsc --noEmit"` — do NOT switch to `tsc -b`):

```jsonc
"scripts": {
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "e2e": "playwright test",
  "lint": "eslint .",
  "build:runtime": "pnpm --filter @savig/runtime build:runtime",
  "dev": "pnpm --filter @savig/app-react dev",
  "mcp": "pnpm --filter @savig/mcp start"
}
```

- [ ] **Step 4: Verify install + tests still work (nothing moved yet).**

Run: `pnpm install && pnpm test`
Expected: install succeeds; unit tests PASS.

- [ ] **Step 5: Commit.**

```bash
git add pnpm-workspace.yaml tsconfig.json package.json
git commit -m "build: scaffold pnpm workspace + centralize typecheck config"
```

---

### Task 4: Extract `@savig/engine` (base package, 0 deps)

**Files:**
- Create: `packages/engine/package.json`
- Move: `src/engine/**` → `packages/engine/src/**`
- Modify: alias targets in `tsconfig.json` + `vite.config.ts` (repoint `@savig/engine`)

**Interfaces:**
- Produces: `@savig/engine` package exporting the current `engine/index.ts` surface unchanged.

- [ ] **Step 1: Move the directory with git.**

Run: `mkdir -p packages/engine && git mv src/engine packages/engine/src`
Expected: `src/engine` now lives at `packages/engine/src`.

- [ ] **Step 2: Create `packages/engine/package.json`:**

```json
{
  "name": "@savig/engine",
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "polygon-clipping": "0.15.7" }
}
```

- [ ] **Step 3: Repoint aliases** to the new location. In `tsconfig.json` `paths` and `vite.config.ts` alias, change `@savig/engine` → `packages/engine/src/index.ts`. Also update the Vitest `environmentMatchGlobs` in `vite.config.ts`: `['src/engine/geom/svg/**', 'jsdom']` → `['packages/engine/src/geom/svg/**', 'jsdom']`. (No per-package tsconfig — the root `include` from Task 3 already covers `packages/**`.)

- [ ] **Step 4: Verify green.**

Run: `pnpm install && pnpm test`
Expected: engine's own tests + all dependents PASS (alias absorbs the move).

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "refactor: extract @savig/engine package (move-only, deps: polygon-clipping)"
```

---

### Task 5: Extract `@savig/runtime` + relocate the bundle build (W4)

**Files:**
- Create: `packages/runtime/package.json`
- Move: `src/runtime/**` → `packages/runtime/src/**`; `scripts/build-runtime.mjs` → `packages/runtime/scripts/build-runtime.mjs`
- Modify: the build script's entry/output paths; alias targets; `vite.config.ts` env glob `src/runtime/**` → `packages/runtime/src/**`

**Interfaces:**
- Consumes: `@savig/engine`.
- Produces: `@savig/runtime` (deps: engine) + a `build:runtime` script that regenerates `src/runtimeSource.generated.ts` in-package.

- [ ] **Step 1: Move dir + script.**

Run:
```bash
mkdir -p packages/runtime && git mv src/runtime packages/runtime/src
mkdir -p packages/runtime/scripts && git mv scripts/build-runtime.mjs packages/runtime/scripts/build-runtime.mjs
```

- [ ] **Step 2: Update the build script paths.** The script runs via `pnpm --filter @savig/runtime build:runtime`, whose cwd is the package dir (`packages/runtime`), so paths must be **package-relative**: change `entryPoints: ['src/runtime/index.ts']` → `['src/index.ts']` and `writeFileSync('src/runtime/runtimeSource.generated.ts', …)` → `writeFileSync('src/runtimeSource.generated.ts', …)`.

- [ ] **Step 3: Create `packages/runtime/package.json`:**

```json
{
  "name": "@savig/runtime",
  "version": "0.0.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./runtimeSource.generated": "./src/runtimeSource.generated.ts",
    "./frame": "./src/frame.ts"
  },
  "scripts": { "build:runtime": "node scripts/build-runtime.mjs" },
  "dependencies": { "@savig/engine": "workspace:*" },
  "devDependencies": { "esbuild": "^0.28.1" }
}
```

- [ ] **Step 4: Repoint aliases** (`@savig/runtime`, `@savig/runtime/runtimeSource.generated`, and add `@savig/runtime/frame`) to `packages/runtime/src/*` in `tsconfig.json` `paths` + `vite.config.ts` alias. Update the Vitest env glob `['src/runtime/**', 'jsdom']` → `['packages/runtime/src/**', 'jsdom']`.

- [ ] **Step 5: Regenerate the bundle and verify it is unchanged.**

Run: `pnpm --filter @savig/runtime build:runtime && git diff --stat packages/runtime/src/runtimeSource.generated.ts`
Expected: script prints byte count; the generated file is functionally identical (only path-comment differences, if any).

- [ ] **Step 6: Verify green.**

Run: `pnpm install && pnpm test`
Expected: runtime tests + services `exportProject` tests (which import the generated bundle) PASS.

- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "refactor: extract @savig/runtime + relocate build:runtime script (W4)"
```

---

### Task 6: Extract `@savig/services`

**Files:**
- Create: `packages/services/package.json`
- Move: `src/services/**` → `packages/services/src/**`
- Modify: alias target; `vite.config.ts` env glob `src/services/**` → `packages/services/src/**`

**Interfaces:**
- Consumes: `@savig/engine`, `@savig/runtime` (+ `/runtimeSource.generated`).
- Produces: `@savig/services` (deps: engine, runtime, fflate).

- [ ] **Step 1: Move dir.** `mkdir -p packages/services && git mv src/services packages/services/src`

- [ ] **Step 2: Create `packages/services/package.json`:**

```json
{
  "name": "@savig/services",
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts", "./export/renderDocument": "./src/export/renderDocument.ts" },
  "dependencies": {
    "@savig/engine": "workspace:*",
    "@savig/runtime": "workspace:*",
    "fflate": "^0.8.3"
  }
}
```

(`./export/renderDocument` is exported because `@savig/core/node`'s `render.ts` imports it directly.)

- [ ] **Step 3: Repoint aliases** `@savig/services` + `@savig/services/export/renderDocument` → `packages/services/src/*` in `tsconfig.json` `paths` + `vite.config.ts` alias; move the jsdom env glob `['src/services/**', 'jsdom']` → `['packages/services/src/**', 'jsdom']`.

- [ ] **Step 4: Verify green.**

Run: `pnpm install && pnpm test`
Expected: services tests (export/import/persistence/audio) PASS.

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "refactor: extract @savig/services package (deps: engine, runtime, fflate)"
```

---

### Task 7: Extract `@savig/core` with browser/node subpath split (W3)

**Files:**
- Create: `packages/core/package.json`
- Move: `src/core/**` → `packages/core/src/**`; `src/types/gifenc.d.ts` → `packages/core/src/node/gifenc.d.ts`
- Modify: `packages/core/src/index.ts` (remove render/gif re-exports), create `packages/core/src/node.ts`, alias targets

**Interfaces:**
- Consumes: `@savig/engine` (browser); `@savig/services/export/renderDocument`, `@savig/runtime/frame` (node).
- Produces: `@savig/core` (browser-safe, deps: engine) + `@savig/core/node` (render+gif, deps: engine, services, runtime, @resvg/resvg-js, gifenc).

- [ ] **Step 1: Move dir + ambient types.**

Run:
```bash
mkdir -p packages/core/src/node && git mv src/core/* packages/core/src/
git mv packages/core/src/render.ts packages/core/src/node/render.ts
git mv packages/core/src/gif.ts packages/core/src/node/gif.ts
git mv src/types/gifenc.d.ts packages/core/src/node/gifenc.d.ts && rmdir src/types 2>/dev/null; true
```

- [ ] **Step 2: Split the public surface.** In `packages/core/src/index.ts`, **delete** the two node-only re-export lines (current lines 10–11: `renderFrameSvg…` from `./render` and `renderGif…` from `./gif`). Create `packages/core/src/node.ts`:

```ts
// @savig/core/node — Node-only rasterization surface (native deps).
export { renderFrameSvg, renderFramePng, renderFrameRgba, renderThumbnail, renderFrames, type RasterOpts } from './node/render';
export { renderGif, type GifOpts } from './node/gif';
```

Update the two moved files' internal imports: `./node/render.ts` and `./node/gif.ts` now import siblings via `../` (e.g. `../describe`) and cross-package via `@savig/engine`, `@savig/services/export/renderDocument`, `@savig/runtime/frame` (the codemod already made the cross-package ones aliases; fix the now-one-level-deeper sibling relatives).

- [ ] **Step 2b: Fix the one external consumer of the removed index exports.** `mcp/tools.ts` imports `renderFramePng`, `renderThumbnail`, `renderGif` from `@savig/core` (its `../core` import, converted by the codemod). Since Step 2 removed those from the core index, split the mcp import: keep builders/`describeProject`/etc. from `@savig/core`, and add a separate line for the three raster symbols from `@savig/core/node`:

```ts
import { renderFramePng, renderThumbnail, renderGif } from '@savig/core/node';
```

Remove those three names from the existing `@savig/core` import in `mcp/tools.ts`. (mcp is a Node consumer, so importing `/node` is correct and safe.)

- [ ] **Step 3: Create `packages/core/package.json` with subpath exports.** The `./node` entry's deps (`@savig/services`, `@savig/runtime`, `@resvg/resvg-js`, `gifenc`) are real runtime `dependencies` of the package (browser consumers just never import the `./node` entry, so a bundler tree-shakes them out):

```json
{
  "name": "@savig/core",
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts", "./node": "./src/node.ts" },
  "dependencies": {
    "@savig/engine": "workspace:*",
    "@savig/services": "workspace:*",
    "@savig/runtime": "workspace:*",
    "@resvg/resvg-js": "^2.6.2",
    "gifenc": "^1.0.3"
  }
}
```

- [ ] **Step 4: Repoint aliases:** `@savig/core` → `packages/core/src/index.ts`; `@savig/core/node` → `packages/core/src/node.ts` (was `render.ts`) in `tsconfig.json` `paths` + `vite.config.ts` alias (keep `/node` listed before `/core`).

- [ ] **Step 5: Verify green** (core browser tests + `camera.test.ts` which uses services + render/gif tests + `mcp/tools.test.ts` after the Step 2b import split).

Run: `pnpm install && pnpm test`
Expected: all core + mcp tests PASS; no test imports `@savig/core/node` from a browser-env project.

- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "refactor: extract @savig/core with browser/node subpath split (W3)"
```

---

### Task 8: Extract `@savig/mcp` (bin package)

**Files:**
- Create: `packages/mcp/package.json`
- Move: `src/mcp/**` → `packages/mcp/src/**`
- Modify: alias target

**Interfaces:**
- Consumes: `@savig/core`, `@savig/engine`, `@savig/services`.
- Produces: `@savig/mcp` runnable via `pnpm --filter @savig/mcp start` (`tsx src/main.ts`). No `bin` field yet — a real `bin` needs a built JS file with a shebang, which is deferred to a later packaging slice.

- [ ] **Step 1: Move dir.** `mkdir -p packages/mcp && git mv src/mcp packages/mcp/src`

- [ ] **Step 2: Create `packages/mcp/package.json`:**

```json
{
  "name": "@savig/mcp",
  "version": "0.0.0",
  "type": "module",
  "scripts": { "start": "tsx src/main.ts" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "@savig/core": "workspace:*",
    "@savig/engine": "workspace:*",
    "@savig/services": "workspace:*"
  },
  "devDependencies": { "tsx": "^4.22.4" }
}
```

- [ ] **Step 3: Repoint alias** `@savig/mcp` → `packages/mcp/src/server.ts` in `tsconfig.json` `paths` + `vite.config.ts` alias.

- [ ] **Step 4: Verify green + the MCP server still boots.**

Run: `pnpm install && pnpm test && pnpm --filter @savig/mcp exec tsx -e "import('./src/server.ts').then(()=>console.log('mcp import ok'))"`
Expected: `tools.test.ts` PASS; `mcp import ok` printed.

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "refactor: extract @savig/mcp package (bin, deps: core/engine/services)"
```

---

### Task 9: Relocate `src/ui` → `apps/react` (store stays React-bound)

**Files:**
- Create: `apps/react/package.json`, `apps/react/vite.config.ts`, `apps/react/index.html`
- Modify: `e2e/multi-scene-export.spec.ts`, `e2e/scenes-transition.spec.ts` (repoint `../src/*` imports)
- Move: `src/ui/**` → `apps/react/src/**`; `src/main.tsx` → `apps/react/src/main.tsx`; `src/vite-env.d.ts` → `apps/react/src/`; root `index.html` → `apps/react/index.html`
- Move: `src/test-setup.ts` → **root** `vitest.setup.ts` (NOT into the app — it is shared: services tests use its `fake-indexeddb/auto` + jest-dom, UI tests use its PointerEvent polyfill)
- Rename: root `vite.config.ts` → `vitest.config.ts` (central test-only config); Playwright `webServer`/`baseURL` if pinned to root

**Interfaces:**
- Consumes: all `@savig/*` packages (browser-safe `@savig/core`, not `/node`).
- Produces: `apps/react` — the existing editor, byte-for-byte behavior, at a new path. Store still `create` from `zustand` (vanilla swap is Slice 3).

- [ ] **Step 1: Move the UI tree + entry files.** (`test-setup.ts` goes to the repo root as `vitest.setup.ts`, not into the app — it is shared with services tests.)

Run:
```bash
mkdir -p apps/react/src
git mv src/ui apps/react/src/ui
git mv src/main.tsx apps/react/src/main.tsx
git mv src/vite-env.d.ts apps/react/src/vite-env.d.ts
git mv index.html apps/react/index.html
git mv src/test-setup.ts vitest.setup.ts
```

- [ ] **Step 2: Fix the entry + html paths.** In `apps/react/index.html`, update the script src to `/src/main.tsx`. In `apps/react/src/main.tsx`, confirm it imports `./ui/App` (relative, unchanged).

- [ ] **Step 3: Create `apps/react/package.json`:**

```json
{
  "name": "@savig/app-react",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview" },
  "dependencies": {
    "@savig/engine": "workspace:*",
    "@savig/core": "workspace:*",
    "@savig/services": "workspace:*",
    "@savig/runtime": "workspace:*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zustand": "^5.0.14"
  },
  "devDependencies": { "@vitejs/plugin-react": "^4.3.1" }
}
```

- [ ] **Step 4: Create `apps/react/vite.config.ts`** — move the React plugin + the `@savig/*` alias block here (dev consumes source, R7), and set `root` implicitly (config lives in app dir):

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const alias = {
  '@savig/engine': r('../../packages/engine/src/index.ts'),
  '@savig/core/node': r('../../packages/core/src/node.ts'),
  '@savig/core': r('../../packages/core/src/index.ts'),
  '@savig/services/export/renderDocument': r('../../packages/services/src/export/renderDocument.ts'),
  '@savig/services': r('../../packages/services/src/index.ts'),
  '@savig/runtime/runtimeSource.generated': r('../../packages/runtime/src/runtimeSource.generated.ts'),
  '@savig/runtime/frame': r('../../packages/runtime/src/frame.ts'),
  '@savig/runtime': r('../../packages/runtime/src/index.ts'),
};
export default defineConfig({ plugins: [react()], resolve: { alias } });
```

- [ ] **Step 5: Fix the two e2e specs that import moved source.** `e2e/multi-scene-export.spec.ts` and `e2e/scenes-transition.spec.ts` import `from '../src/engine'` and `from '../src/services/export/exportProject'`. Playwright does not resolve the Vite `@savig/*` aliases, so repoint them to the new package source paths directly:

```ts
// both spec files:
import { createProject, createVectorAsset, createSceneObject } from '../packages/engine/src';
import { exportProject } from '../packages/services/src/export/exportProject';
```

(No `apps/react/tsconfig.json` is created — the root `tsconfig.json` `include` from Task 3 already covers `apps/**`, and the root already sets `jsx: react-jsx` + DOM lib.)

- [ ] **Step 6: Rename + finalize the central test config.** Rename root `vite.config.ts` → `vitest.config.ts`. It keeps `plugins: [react()]` (needed to transform `.tsx` test files), the `@savig/*` `resolve.alias` + `test.alias` blocks (now pointing at `packages/*/src`), and updates:
  - `setupFiles: ['./vitest.setup.ts']` (moved from `./src/test-setup.ts`);
  - `environmentMatchGlobs` repointed and extended: `['apps/react/src/**', 'jsdom']`, `['packages/services/src/**', 'jsdom']`, `['packages/runtime/src/**', 'jsdom']`, `['packages/engine/src/geom/svg/**', 'jsdom']`; default `environment: 'node'`.

```ts
// vitest.config.ts (was vite.config.ts) — test-only
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const alias = {
  '@savig/engine': r('./packages/engine/src/index.ts'),
  '@savig/core/node': r('./packages/core/src/node.ts'),
  '@savig/core': r('./packages/core/src/index.ts'),
  '@savig/services/export/renderDocument': r('./packages/services/src/export/renderDocument.ts'),
  '@savig/services': r('./packages/services/src/index.ts'),
  '@savig/runtime/runtimeSource.generated': r('./packages/runtime/src/runtimeSource.generated.ts'),
  '@savig/runtime/frame': r('./packages/runtime/src/frame.ts'),
  '@savig/runtime': r('./packages/runtime/src/index.ts'),
};
export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    globals: true,
    environment: 'node',
    alias,
    exclude: ['e2e/**', 'node_modules/**', '**/dist/**'],
    environmentMatchGlobs: [
      ['apps/react/src/**', 'jsdom'],
      ['packages/services/src/**', 'jsdom'],
      ['packages/runtime/src/**', 'jsdom'],
      ['packages/engine/src/geom/svg/**', 'jsdom'],
    ],
    setupFiles: ['./vitest.setup.ts'],
  },
});
```

(Because tests run from this one central config, Tasks 4–8's "repoint the env glob" edits all land in this same file — by Task 9 it is renamed and holds the final glob set above.)

- [ ] **Step 7: Update Playwright config** (`playwright.config.ts`) `webServer.command` → `pnpm --filter @savig/app-react dev` and confirm `baseURL`/port match Vite's default (5173) or the app's configured port.

- [ ] **Step 8: Verify FULL green — unit + e2e.**

Run: `pnpm install && pnpm test && pnpm e2e`
Expected: all ~1,700 unit tests PASS; all 68 e2e specs PASS against the relocated app.

- [ ] **Step 9: Commit.**

```bash
git add -A
git commit -m "refactor: relocate src/ui -> apps/react (store still React-bound; vanilla swap deferred)"
```

---

### Task 10: Finalize central type-check config (R8 deferral)

**Files:**
- Modify: `tsconfig.json` (confirm broad `include` + `paths`; delete stale `tsbuildinfo`)

**Interfaces:**
- Produces: `tsc --noEmit` type-checks the entire moved tree in one pass. Project references / `composite` are **deferred** — they conflict with the repo's `allowImportingTsExtensions`+`noEmit` (verified: zero `.ts`-extension imports, so switching later is possible but unnecessary now). Dev consumes source (R7), so no per-package build graph is needed.

- [ ] **Step 1: Confirm the root `tsconfig.json` covers everything.** Its `include` (Task 3) is `["src", "packages", "apps", "vite.config.ts", "vitest.config.ts"]` — since `src` is now empty of moved code, it can be trimmed to `["packages", "apps", "vitest.config.ts", "apps/react/vite.config.ts"]`. Its `paths` map every `@savig/*` to `packages/*/src`. Keep `tsconfig.node.json` only if `apps/react/vite.config.ts` still needs it; otherwise leave as-is. Delete the stale root `tsconfig.tsbuildinfo`.

Run: `rm -f tsconfig.tsbuildinfo`

- [ ] **Step 2: Verify the whole tree type-checks.**

Run: `pnpm typecheck` (`tsc --noEmit`)
Expected: exit 0 — no `TS2307` (unresolved `@savig/*`) or other errors across packages + app.

- [ ] **Step 3: Verify tests still green.**

Run: `pnpm test`
Expected: all unit tests PASS.

- [ ] **Step 4: Commit.**

```bash
git add -A
git commit -m "build: finalize central tsconfig include/paths (project refs deferred, R8)"
```

---

### Task 11: Distribute root deps, prune, final gate (W7)

**Files:**
- Modify: root `package.json` (keep only shared devDeps + orchestration scripts)

**Interfaces:**
- Produces: a clean workspace where each package owns its deps; no phantom root runtime deps.

- [ ] **Step 1: Prune root `package.json` `dependencies`.** Remove `react`, `react-dom`, `zustand`, `polygon-clipping`, `@resvg/resvg-js`, `gifenc`, `fflate`, `@modelcontextprotocol/sdk` from root (now owned by their packages). Keep root `devDependencies` for shared tooling: `typescript`, `vitest`, `vite`, `eslint`, `@eslint/js`, `typescript-eslint`, `@playwright/test`, `@testing-library/*`, `@types/*`, `jsdom`, `fake-indexeddb`, `tsx`, `esbuild`, `ts-morph`.

- [ ] **Step 2: Reinstall from scratch to surface phantom deps.**

Run: `rm -rf node_modules packages/*/node_modules apps/*/node_modules && pnpm install`
Expected: install succeeds; no `ERR_PNPM_...` about missing peer/undeclared deps.

- [ ] **Step 3: Full verification — the Slice 1 gate.**

Run: `pnpm typecheck && pnpm test && pnpm e2e && pnpm lint`
Expected: `tsc --noEmit` clean; ~1,700 unit PASS; 68 e2e PASS; lint clean.

- [ ] **Step 4: Regenerate the runtime bundle once more and confirm no drift.**

Run: `pnpm build:runtime && git diff --exit-code packages/runtime/src/runtimeSource.generated.ts`
Expected: exit 0 (no diff — the committed bundle matches a fresh build).

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "build: distribute deps to packages, prune root, Slice 1 green gate (W7)"
```

---

## Self-Review (against the spec)

**Spec coverage (Slice 1 scope = §9 step 1 + W3/W4/W6/W7/R3/R7/R8):**
- Workspace scaffold → Task 3. ✅
- Move-only packages engine/core/services/runtime/mcp → Tasks 4–8. ✅
- `apps/react` relocation (added to step 1 during review) → Task 9. ✅
- W3 core browser/node split + `gifenc.d.ts` placement → Task 7. ✅
- W4 runtime bundle relocation + build order → Task 5 + Task 11 step 4. ✅
- W6 import codemod, isolated commit → Task 2. ✅
- W7 per-package deps + phantom-dep check → Tasks 4–9 (deps) + Task 11 (clean reinstall). ✅
- R3 per-package Vitest env (repoint `environmentMatchGlobs`) → Tasks 4/5/6 (per-move) consolidated in the single central config, finalized Task 9 step 6. ✅
- R7 dev-consume-source aliases → Task 1 + Task 9 step 4 (app) + Task 9 step 6 (tests). ✅
- R8 — project references/`composite` **deferred** (conflict with `allowImportingTsExtensions`+`noEmit`); central single-tsconfig `paths` type-check instead → Task 3 + Task 10. ✅ (spec R8 updated to match.)
- Out of scope by design (later slices): interaction extraction (S2), vanilla store (S3), viewmodels (S4), controllers/theme (S5), Svelte app/test-contract/@portable subset (S6). Noted in Roadmap. ✅

**Placeholder scan:** No "TBD/TODO"; every config file, the codemod script, and the central test config are given in full.

**Type/name consistency:** package names (`@savig/engine`/`core`/`services`/`runtime`/`mcp`, app `@savig/app-react`), subpath exports (`@savig/core/node`, `@savig/services/export/renderDocument`, `@savig/runtime/runtimeSource.generated`, `@savig/runtime/frame`) are used identically across Tasks 1, 2 (codemod output), 4–11. `build:runtime` script name consistent (Task 5 defines, Task 3/10 invoke). `typecheck` = `tsc --noEmit` everywhere (Task 3 defines, Task 10 invokes) — no stray `tsc -b`.

**Known ordering note:** Tasks 4–8 each temporarily leave `apps/react` (still at `src/ui` until Task 9) importing `@savig/*` via aliases that already resolve — green holds because Task 2 already converted those imports and Task 1's aliases move with each task. Task 9 is the first that touches the app tree.

**Review-pass fixes applied (2nd/3rd pass):** garbled `git mv` (Task 4); duplicated `dependencies` block (Task 7); `pnpm --filter` cwd-relative build paths (Task 5); broken `.ts` `bin` dropped (Task 8); `mcp/tools.ts` render/gif import split to `@savig/core/node` before the core index loses those exports (Task 7 step 2b); shared `test-setup.ts` kept at root as `vitest.setup.ts`, not moved into the app (Task 9); central `vitest.config.ts` fully specified (Task 9 step 6); two `e2e` specs importing `../src/*` repointed (Task 9 step 5); project references/`composite` dropped in favor of a single central tsconfig (`allowImportingTsExtensions`+`noEmit` conflict; Tasks 3/10).
