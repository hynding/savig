# CLAUDE.md

Guidance for agents working in this repo. The user-facing overview is in [README.md](README.md).

## What this is

Savig is a Flash / Animate-style vector animation studio that runs in the browser, plus a headless
authoring API and MCP server so agents can build the same animations. A pnpm workspace of
TypeScript packages consumed as source (no package build step), a React editor, and a small Svelte
proof of concept.

## Commands

```sh
pnpm install
pnpm dev                     # React editor, http://localhost:5173
pnpm test                    # all Vitest unit tests (~4,400 tests, ~75 s)
pnpm vitest run <path>       # one file or folder
pnpm e2e                     # Playwright; starts the React (5173) and Svelte (5174) dev servers
pnpm e2e e2e/foo.spec.ts --project=react --trace off   # one spec
pnpm typecheck               # tsc --noEmit
pnpm lint                    # eslint .
pnpm build:runtime           # regenerate packages/runtime/src/runtimeSource.generated.ts
pnpm mcp                     # MCP server on stdio
pnpm --filter @savig/app-react build   # production build -> apps/react/dist
```

A change is ready when `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm e2e` all pass.

## Architecture

Dependencies point down this list; nothing lower imports anything higher.

- `apps/react` (editor UI), `apps/svelte` (PoC), `packages/mcp` (MCP server)
- `packages/ui-core`: framework-neutral commands, controllers and view-models
- `packages/editor-state`: the vanilla Zustand store (`store.ts` + `slices/`)
- `packages/core`: headless builders, DSL, describe, validate; `core/node` renders in Node
- `packages/services`: file format, persistence, import, exporters, audio, cloud client
- `packages/runtime`: the standalone player bundled into exports
- `packages/interaction`: pure editing geometry (hit tests, handles, snapping)
- `packages/engine`: the document model and all animation / geometry math

Key places:

- **Model.** `packages/engine/src/types.ts` defines `Project`, `SceneObject`, assets, keyframes.
  `engine/src/sample.ts` (`sampleObject`) evaluates an object at a time; every renderer goes through it.
- **Rendering.** `services/src/export/renderDocument.ts` builds the SVG document;
  `runtime/src/frame.ts` (`computeFrame` / `applyFrameToNodes`) applies a frame to it. The editor
  Stage, the preview, exported HTML, headless PNG and GIF renders all share this seam, so a feature
  that renders in one place renders everywhere.
- **Exporters** live in `services/src/export/`: `buildBundle.ts` (zip with `index.html` +
  `savig-runtime.js`), `animatedSvg.ts` (SMIL), `cssSvg.ts`, `lottie.ts`, `spriteSheet.ts`,
  `videoArgs.ts` (ffmpeg.wasm argv). Node renders are in `core/src/node/`.
- **Editor store.** `editor-state/src/store.ts`. Every edit goes through `commit(next)`, which
  pushes undo history and auto re-bakes shape tweens and bone springs (`autoRebake.ts`). Store
  actions are wrapped by `labelActions` (`historyLabels.ts`) so each undo step gets a name for the
  History panel; a new action is labeled from its name automatically.
- **Commands.** `ui-core/src/commands/registry.ts` holds every palette command and keyboard shortcut
  (`when` predicates, chords). Tools are `tool.<id>` there and are listed for the toolbar in
  `apps/react/src/ui/components/Toolbar/ToolPalette.tsx`.
- **View-models.** UI reads framework-neutral view-models from `ui-core/src/viewmodels/` through
  `useEditorVM` (`apps/react/src/ui/store/store.ts`). Keep logic there or in controllers, not in
  React components, so the Svelte app can reuse it.
- **Agent surface.** `core/src/index.ts` exports the builders; `core/src/dsl.ts` is the `ShortDoc`
  JSON DSL; `describe.ts` / `validate.ts` give agents text feedback. MCP tools are a table in
  `packages/mcp/src/tools.ts`, and `server.ts` is only the stdio transport.
- **Scripting.** SavigScript (`engine/src/script/`) powers behaviors and global handlers.

## Conventions

- **Optional fields keep parity.** New model fields are optional, and "absent" must render and
  export byte-identically to before. Code comments call this "parity"; preserve it.
- **File format.** Saving a model change that older builds would misread needs a bump of
  `CURRENT_VERSION` in `services/src/persistence/migrate.ts` (currently 12) with a migration note,
  and a `sanitize*.ts` in `services/src/persistence/` so malformed or hostile files load safely.
- **Runtime source is generated.** After changing anything the runtime imports from the engine, run
  `pnpm build:runtime` and commit `runtimeSource.generated.ts`. Never edit it by hand. Demo bundles
  in `apps/react/public/` are also generated.
- **Agent parity.** A feature ships in the editor *and* for agents: a `@savig/core` builder,
  `describe` / `validate` coverage where relevant, DSL support where it fits, and an MCP tool.
  Features usually land as an editor PR followed by an agents PR.
- **Every renderer.** A visual feature must work in the Stage, preview, exported HTML, SMIL SVG,
  CSS SVG, Lottie (or emit a warning when it can't), and Node raster renders.
- **Tests sit beside the code** as `*.test.ts(x)`. `vitest.config.ts` runs `apps/react`,
  `services`, `runtime` and `engine/src/geom/svg` tests in jsdom, everything else in Node.
  E2E specs are in `e2e/`; `portable-*.spec.ts` also runs against the Svelte app.
- Path aliases (`@savig/...`) are declared three times: `tsconfig.json`, `vitest.config.ts` and
  `apps/react/vite.config.ts`. Add a new subpath export to all three.
- Unused parameters must start with `_` (lint rule).

## E2E gotchas

- Playwright's `webServer` reuses a running dev server locally. A stale or plain `pnpm dev` server
  serves an old bundle and lacks the dummy Supabase env vars, so cloud specs fail and the toolbar
  layout differs. Kill stray dev servers before a definitive run.
- Don't edit app files while e2e runs: Vite HMR reloads break tests mid-run.
- The toolbar must fit one row at 1280 px (`e2e/toolbar-fit.spec.ts`). Adding a tool can overflow
  it and shift the Stage, which breaks snapping specs.
- `[data-savig-object]` matches both a symbol instance container and its leaves; count leaves with
  `[data-savig-object*="/"]`.
- Use `exact: true` with `getByRole(..., { name })` when a new label could contain an existing one.
- In Claude Code cloud containers the pinned `@playwright/test` doesn't match the preinstalled
  browser. Run with a local, uncommitted config that sets
  `use.launchOptions.executablePath: '/opt/pw-browsers/chromium'` (spread over
  `playwright.config.ts`), and keep that file out of git.

## Docs and history

- `docs/superpowers/specs/` (design specs) and `docs/superpowers/plans/` (task plans), dated by
  authoring day. `docs/superpowers/INDEX.md` maps every feature to its spec, plan and merge. Read
  the spec before changing a feature; add a spec and plan for a new one.
- `docs/CLOUD-SETUP.md` covers the optional Supabase cloud save.
- `main` deploys to GitHub Pages (`.github/workflows/deploy-pages.yml`); there is no CI test
  workflow, so run the checks locally.
- Work ships as small, reviewable PRs titled like `Roadmap 13 (5/6): 9-slice scaling for symbols`.
