# M5 — Agent Authoring & Headless Render (design)

**Goal:** make Savig a first-class target for an AI agent producing animated shorts, by exposing
its (already pure) engine as a headless, id-addressed, scriptable surface; giving the agent a
*perceive→act* loop (render frames it can see + introspect/validate the project); and a high-level
declarative format + macros so an LLM composes *intent*, not raw keyframe numbers.

> **Roadmap note:** this milestone is sequenced as the next one to execute. It *pulls forward and
> reshapes* the original roadmap's **M8 (video/GIF)** → the render slice, and **M9 (scripting)** →
> the DSL/SDK slices, plus a slice of **M7 (scenes)**. The original "M5 CSS export" shifts later.

## Why this is tractable (architecture)

Savig already separates a **pure engine** (`src/engine`, `Project → frames`, fully testable in
jsdom — no DOM needed) from the **React UI**. The agent wants the engine, not the UI. Most of this
milestone is *exposing and shaping* existing pure functions, not new animation tech:

- `createProject`, `createSceneObject/createGroupObject/createVectorAsset/createSymbolAsset`,
  `createKeyframe`, `newId` — pure builders (`engine/project.ts`).
- `upsertKeyframe`, `removeKeyframeAt`, `samplePath`, `sampleObject` — pure track ops.
- `flattenInstances`, `computeFrame`, `computeProjectDuration` — pure frame/duration.
- `renderSvgDocument(project, opts)` — **headless** self-contained animated-SVG export.
- `saveSavig`/`loadSavig` — headless `.savig` (de)serialization.
- `booleanOp`, morph, motion, gradient — pure geometry.

The barrier today is that everything an agent would drive runs through the **selection-coupled
Zustand store** (`useEditor` — "operate on *the selection*", pointer-driven) and there is no way
for an agent to *see* output. This milestone fixes both.

## Design decisions (assumptions — flag to revisit)

1. **No new package tooling.** `@savig/core` ships as an internal module `src/core/` with a clean
   public entry `src/core/index.ts` (re-exported from a top-level `savig` barrel later), not a
   separate npm workspace. Keeps the single-Vite-app build; a real package split can come later.
2. **Pure & store-free.** Every core function takes a `Project` (+ explicit args) and returns a new
   `Project` (or a `{ project, id }` when it creates an object). No `useEditor`, no selection, no
   `getStageCursor`. The UI store keeps wrapping these for humans; the core is the agent's API.
3. **Deterministic IDs.** `newId()` is random (fine for humans, bad for agents — non-reproducible,
   non-diffable). Core builders accept an optional explicit `id`, and ship a seeded `idFactory` so a
   whole short is reproducible from a seed.
4. **Rasterizer = resvg-js** (static per-frame `Project × t → PNG`), chosen over headless-Chrome for
   determinism + no browser dependency. Video/GIF (slice 5) composes frames via an encoder. (Revisit
   if a native dep is unwanted — fallback is headless-Chrome screenshotting the runtime bundle.)
5. **DSL = JSON** (not a bespoke text grammar) — LLMs emit structured JSON reliably; a compiler maps
   it to a `Project` via the core builders. A thin YAML front-end can come later.

## Slice plan

Executed in the project's standard cadence (TDD → `feature-dev:code-reviewer` pass → `--no-ff`
merge), each slice green on `pnpm test` + `pnpm typecheck` + `pnpm lint` (+ `pnpm e2e` where UI is
touched). Slices are independently shippable.

| # | Slice | Delivers | Depends on |
|---|-------|----------|------------|
| **1** | **Headless authoring core** | `src/core`: seeded `idFactory`; pure id-addressed builders (shapes, path, primitives, keyframes, base transform, group, symbol, remove, reorder) over `Project`; `describeProject(project) → string`; `validateProject(project) → Issue[]`. The keystone everything else uses. | engine |
| 2 | Render-to-raster (perceive loop) | `renderFrame(project, t, opts) → PNG bytes` (resvg over a static-at-`t` SVG); `renderSpriteSheet`; `renderThumbnail`. Lets an agent *see* its output. | 1 + renderSvgDocument |
| 3 | Scene DSL + compiler | JSON "short" schema (scenes, objects, tracks w/ named easings + relative timing) → `compileShort(dsl) → Project`; `decompile(project) → dsl` (best-effort). | 1 |
| 4 | MCP server | `mcp/` server wrapping 1–3 as tools (`create_short`, `add_shape`, `add_keyframe`, `place_symbol`, `describe_project`, `validate`, `render_frame`, `export_svg`/`export_savig`). Each mutating tool returns a state summary **+ a rendered thumbnail**. | 1,2,3 |
| 5 | Video/GIF export | `renderVideo(project, opts) → mp4/gif` (encode the frame sequence). Absorbs roadmap M8. | 2 |
| 6 | Semantic animation macros | `fadeIn/fadeOut/moveTo/moveAlongPath/scaleTo/spin/stagger/bounceIn/...` expanding to keyframes; named easing presets. Agents compose verbs. | 1 |
| 7 | Templates & example corpus | A gallery of `.savig` shorts **with** their DSL source, as few-shot material + smoke tests. | 3,6 |
| 8 | Scenes + camera (shorts structure) | Multi-shot sequencing + a camera (pan/zoom/transition over the artboard). Pulls forward roadmap M7. | 1,3 |
| 9 | Text primitive | `addText({content, font, ...})` as a first-class animatable object (titles/captions/kinetic type), today only available via imported SVG. | 1 |

## Slice 1 detail (this PR)

`src/core/` — pure, store-free, fully unit-tested:

- **`ids.ts`** — `createIdFactory(seed?)` → `() => string` deterministic counter ids (`o1`, `o2`, …
  or seeded); core builders accept an optional explicit `id` and otherwise fall back to engine
  `newId()` so existing random behavior is unchanged when no factory is threaded.
- **`build.ts`** — id-addressed builders returning `{ project, id }` (create) or `project` (mutate),
  each a thin composition over existing engine functions + the scene helpers' logic, but **root-scene
  only** in v1 (no active-scene/edit-path — that's a UI concern):
  - `addRect/addEllipse(project, { x, y, width, height, id?, style? })`
  - `addPath(project, { path, id?, style? })`, `addPolygon/addStar/addLine(project, spec)`
  - `setKeyframe(project, { objectId, property, time, value, easing? })`
  - `setBaseTransform(project, objectId, partial)`
  - `group(project, ids, { id? })`, `removeObjects(project, ids)`
  - `createSymbolFrom(project, ids, { id? })`, `placeSymbol(project, symId, { x, y, id? })`
- **`describe.ts`** — `describeProject(project) → string`: a compact, token-cheap summary (meta/fps/
  duration; per object: id, kind, name, base xform, track list with keyframe times; assets) the agent
  reasons over instead of raw JSON.
- **`validate.ts`** — `validateProject(project) → Issue[]`: flags zero-duration tracks, off-artboard
  objects, non-finite transforms, keyframes past `computeProjectDuration`, dangling `assetId`/
  `parentId`, symbol cycles. `{ severity: 'error'|'warn', code, message, objectId? }`.
- **`index.ts`** — the public surface.

Non-goals for slice 1: raster, DSL, MCP, macros, scenes, text (their own slices). Builders are
root-scene only. No UI changes.
