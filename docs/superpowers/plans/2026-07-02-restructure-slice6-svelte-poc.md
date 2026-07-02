# Slice 6 — Svelte 5 PoC + `@portable` e2e contract (the restructure finale)

**Goal:** prove the framework-agnostic restructure works by rebuilding a thin UI slice in Svelte 5
on the SAME neutral `@savig/*` packages (store, view-models, controllers, theme, runtime render).
A `@portable` e2e spec runs against BOTH the React (5173) and Svelte (5174) apps and asserts an
identical rendered frame — swappability, demonstrated end-to-end.

## The neutral render contract (what both apps already agree on)
Wrapper `<g data-savig-object="<renderId>">` with the shape as its `firstElementChild`, plus a
`Map<string, Element>` of those wrappers, mutated by `applyFrameToNodes(nodes, computeFrame(project,
time))` (both from `@savig/runtime/frame`). Initial SVG markup comes free from
`renderSvgDocument(project)` (`@savig/services/export/renderDocument`) — it emits exactly those
`data-savig-object` wrappers. The React Stage populates the map via ref callbacks; the Svelte PoC
does `{@html renderSvgDocument(project)}` then `querySelectorAll('[data-savig-object]')` — the same
approach `packages/runtime/src/index.ts` uses.

**Key consequence:** both apps paint through the identical `computeFrame`/`applyFrameToNodes`, so a
seeked transform string is byte-identical BY CONSTRUCTION. The portable proof is near-tautological —
which is the point: the UI framework is irrelevant to the rendered result.

**`savigSeek` must be SYNCHRONOUS** on both apps: `applyFrameToNodes(nodesMap, computeFrame(project,
t))` directly, so a single `page.evaluate(t => { savigSeek(t); return el.getAttribute('transform') })`
reads a painted frame with no RAF/React-commit race. React's seek can't go through `store.seek` (async
re-render); it must call `applyFrame(nodesRef.current, project, t)` directly on the app's node map.

## Groups (SDD: implement → SONNET review → fix → merge)

**G1 — apps/svelte scaffold + Stage render + savigSeek.**
- `apps/svelte/`: package.json (svelte 5, vite, @sveltejs/vite-plugin-svelte, all `@savig/* workspace:*`),
  vite.config.ts (server.port 5174 + the SAME `@savig/*` source-alias block as apps/react, swap plugin),
  index.html, src/main.ts, tsconfig, svelte.config.
- `src/lib/editor.ts`: Svelte-store binding over the vanilla `@savig/editor-state` `store` — a readable
  `{ subscribe }` that pushes `store.getState()` on every `store.subscribe`; re-export the vanilla
  `store` for intents/controllers.
- `App.svelte`: `{@html renderSvgDocument(project)}` into an `<svg>` host; on mount + project change,
  populate a `nodes` Map from `[data-savig-object]`; expose `window.savigSeek(t)` (sync applyFrame) +
  `window.savigLoadProject(p)` (setProject + re-render + re-register). Import `@savig/theme/*.css`.
- Gate: `vite build` for apps/svelte succeeds; a smoke check that the SVG renders + savigSeek moves a
  transform. (No unit tests for the app shell; the neutral packages are already 1840-tested.)

**G2 — view-model panel + controller in Svelte (prove the UI layer).**
- `TransportControls.svelte`: driven by `transportControlsViewModel($editor)` + `transportControlsIntents(store)`
  (play/pause, loop toggle, current-time label). Proves L1 view-models drive Svelte.
- Wire `makePlaybackController(store)` (L2) so Play animates the SVG via the neutral rAF loop
  (deps: getNodes → the Svelte nodes map, applyFrame, createAudioTransport-or-a-noop transport, raf/caf).
  Proves L2 controllers drive Svelte. (A noop transport is fine — no audio in the PoC.)
- Gate: build + a smoke check that Play advances time + repaints.

**G3 — `@portable` e2e contract (both apps).**
- Add `window.savigSeek` (sync) + `window.savigLoadProject` test hooks to the REACT app too
  (App.tsx, guarded — dev/e2e only; React seek = `applyFrame(nodesRef.current, project, t)`).
- `playwright.config.ts`: `projects: [{name:'react', baseURL:5173}, {name:'svelte', baseURL:5174}]` +
  `webServer: [react dev 5173, svelte dev 5174]`. Existing specs → react project only (testIgnore or a
  project-level grepInvert `@portable`… actually: existing specs stay react-only via project testMatch;
  the portable spec is grep `@portable` and runs on both).
- One `e2e/portable-render.spec.ts` (`@portable`): build a fixture project (a rect with x keyframed
  0→100 over 1s) as plain JSON, `savigLoadProject(fixture)`, `savigSeek(0.5)`, assert
  `[data-savig-object]` transform ≈ x 50. Same assertion, both apps → parity proof.
- Gate: `pnpm e2e` green on BOTH projects (existing 109 on react + the portable spec on both).

**G4 — whole-branch review + merge + close the restructure.**
- SONNET whole-branch review; fix; finishing-a-development-branch (merge local main, NO push).
- Memory: restructure COMPLETE (all 6 slices).

## Constraints / gotchas
- Do NOT modify the React Stage's rendering; the only React-app change is the two test hooks (G3).
- Svelte 5 runes (`$state`/`$derived`/`$effect`) or the store-contract (`$editor`) — either; keep it thin.
- The Svelte vite config MUST mirror apps/react's `@savig/*` source aliases (incl. deep subpaths
  `@savig/runtime/frame`, `@savig/services/export/renderDocument`) or imports won't resolve.
- pnpm workspace already globs `apps/*` → apps/svelte is picked up on `pnpm install`.
- SONNET reviewers only (opus subagents inject). Do NOT push.
