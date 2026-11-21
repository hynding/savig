# Savig

Savig is a browser-based vector animation studio in the spirit of Adobe Flash / Animate. You draw
with vector tools, animate on a timeline with keyframes, tweens, symbols and bones, and export
standalone animated SVG, HTML, Lottie, GIF, video or sprite sheets. Everything it can do in the
editor, an AI agent can also do headlessly through a TypeScript API and an MCP server.

**Live editor:** https://hynding.github.io/savig/ (deployed from `main` by GitHub Actions).

Savig is local-first. Projects autosave to the browser (IndexedDB) and save to `.savig` files; no
account or server is needed. Cloud save is optional (see [Cloud projects](#cloud-projects-optional)).

## Features

**Drawing**
- Select, Lasso (freehand / polygon, select or cut), Pen, Node editing, Scissors, Rectangle,
  Ellipse, Polygon, Star, Line, Brush (pressure taper), Spray Brush, Text, Eyedropper,
  Paint Bucket, Eraser and Width (variable-width strokes) tools.
- Fills and strokes with solid colors or linear / radial gradients, dashes, trim paths,
  repeaters, outline stroke, boolean operations (union / subtract / intersect / exclude).
- Color swatches, including global swatches that recolor everything painted from them.
- Skew, Free Transform distort and envelope, 3D rotation (with bake-to-perspective), 9-slice
  scaling for symbols and buttons.
- Import SVG, bitmaps (PNG / JPEG / GIF / WebP), image sequences, and Trace Bitmap to turn a
  picture into vector shapes.
- Rulers, draggable guides, snapping, align and distribute, guide (editor-only) objects.

**Animation**
- Timeline with keyframes on every property, multi-keyframe selection (move, stretch, reverse,
  copy / paste), zoomable frames, onion skinning.
- Custom Bézier easing and a motion editor (value-over-time graph with draggable handles).
- Motion paths, path morphing, shape tweens between frame-by-frame keys with shape hints.
- Frame-by-frame layers (F5 / F6 / F7) with whole-drawing onion skin.
- Nested symbols with independent timelines, time remapping, loop / play-once, swap symbol,
  a library with folders, and button symbols (Up / Over / Down / Hit).
- Bones with inverse kinematics, bone skinning (bend one drawing smoothly) and springs.
- Masks (alpha, inverted and luminance), filters (blur, drop shadow, glow, adjust color),
  blend modes.
- Procedural modifiers (wiggle, loop, ping-pong) on almost every channel.
- Motion presets (20 built-ins plus your own, shareable as preset packs).
- Per-character text animation and text on a path.
- A camera (pan, zoom, rotate, shake) with its own tool and timeline row.
- Multiple scenes with transitions.
- Multitrack audio with waveforms, fades, pan and filters; audio lip sync from loudness or
  from vowel shapes.
- Interactivity: per-object behaviors, global key / scene / tick handlers, variables and
  SavigScript expressions, played in the preview and in exported HTML.
- Undo history with a History panel, a command palette (Ctrl/⌘+K) and a keyboard shortcut
  sheet (Shift+?).

**Export**
- Export bundle (`.zip`: `index.html` + `savig-runtime.js` player, interactive).
- Static SVG snapshot, SMIL-animated SVG, CSS-animated SVG.
- Lottie JSON (for lottie-web, iOS and Android players).
- MP4 video (ffmpeg.wasm, in the browser), animated GIF, sprite sheets.

## Getting started

Requires Node 20+ and pnpm (CI uses pnpm 9; pnpm 10 also works).

```sh
pnpm install
pnpm dev          # editor at http://localhost:5173
```

### Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the React editor (Vite) on port 5173 |
| `pnpm test` | Run all unit tests (Vitest) |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm e2e` | Run Playwright end-to-end tests (starts both dev servers itself) |
| `pnpm typecheck` | `tsc --noEmit` over the whole workspace |
| `pnpm lint` | ESLint |
| `pnpm build:runtime` | Rebuild the standalone player that exports embed |
| `pnpm mcp` | Start the Savig MCP server on stdio |
| `pnpm --filter @savig/app-react build` | Production build of the editor (`apps/react/dist`) |

## Driving Savig from an AI agent

`@savig/core` is a headless, store-free API over the same project model the editor uses:
builders for every feature, a compact JSON DSL (`compileShort` / `decompileProject`), `describe`
and `validate`, templates and macros. `@savig/core/node` adds rendering to PNG (resvg), GIF,
sprite sheets and animated SVG in Node.

`@savig/mcp` wraps it as a stdio [Model Context Protocol](https://modelcontextprotocol.io) server
with about 100 tools (shapes, keyframes, frame-by-frame, bones, masks, filters, scenes, audio,
behaviors, lip sync, `render_frame`, `render_gif`, `export_svg`, `export_lottie`, and more). Most
tools return a text description and a thumbnail so the agent can see its work.

The repo's `.mcp.json` registers it for Claude Code automatically. For other clients, point
them at:

```sh
node_modules/.bin/tsx packages/mcp/src/main.ts    # or: pnpm mcp
```

## Repository layout

A pnpm workspace. Packages are consumed as TypeScript source (no build step); path aliases live in
`tsconfig.json`, `vitest.config.ts` and `apps/react/vite.config.ts`.

| Path | Role |
| --- | --- |
| `packages/engine` | The document model (`types.ts`), sampling / interpolation, geometry, morphing, bones, masks, symbols, SavigScript. No React and no store. |
| `packages/interaction` | Pure geometry for editing: hit testing, handles, snapping, guides. |
| `packages/editor-state` | The editor's Zustand store (vanilla), split into slices; undo history and auto re-bake. |
| `packages/ui-core` | Framework-neutral commands (registry, shortcuts), controllers (drag / tool logic) and view-models. |
| `packages/services` | File format (`.savig`, migrations, sanitizers), autosave, import, every exporter, audio, cloud client. |
| `packages/runtime` | The standalone player embedded in exports; `runtimeSource.generated.ts` is its bundled source. |
| `packages/core` | Headless authoring API for agents, plus `core/node` rendering. |
| `packages/mcp` | The MCP server. |
| `packages/theme` | Shared CSS tokens. |
| `apps/react` | The editor UI. |
| `apps/svelte` | A small Svelte proof of concept that renders and plays a project through the same neutral packages. |
| `e2e` | Playwright specs (React suite; `portable-*.spec.ts` also runs against Svelte). |
| `docs/superpowers` | Design specs and implementation plans for every feature; start at `INDEX.md`. |
| `supabase` | The optional cloud schema (migration only). |

## Cloud projects (optional)

Save to Cloud / Open from Cloud are backed by Supabase and appear only when
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set. Setup is in
[docs/CLOUD-SETUP.md](docs/CLOUD-SETUP.md).

## Contributing

Each feature has a design spec and plan under `docs/superpowers/` and ships in small PRs with unit
and Playwright coverage. Before opening a PR, run `pnpm typecheck`, `pnpm lint`, `pnpm test` and
`pnpm e2e`. Agent-facing conventions are in [CLAUDE.md](CLAUDE.md).
