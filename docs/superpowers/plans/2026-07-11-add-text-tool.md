# Add-Text Tool + Text Selection Bbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `text` editor tool: click-to-place a text object, edit its content/style in the Inspector, select/marquee/move it, and bind it to a path — making text-on-path user-reachable.

**Architecture:** New `'text'` ToolMode (one-shot click-to-place, eyedropper precedent) → `addTextObject(x,y)` store action (mirrors `addVectorShape`; `createTextAsset` + `anchorMode:'absolute'`). Text bbox for editor chrome via a PURE `estimateTextBox` + a text branch in `resolveObjectAnchor` (packages/interaction) — lights up marquee/snap/align/group-bbox; NO engine/runtime/export change (resvg lays out text; absolute-anchor text needs no metrics). Inspector text panel edits content/fontSize/fill/fontFamily/textAnchor via lock-gated store setters.

**Tech Stack:** pnpm monorepo, TS strict, Vitest colocated, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-07-11-add-text-tool-design.md` (approved; Decisions 1–6 binding).

## Global Constraints

- **No engine/runtime/services/bundle change for rendering** — text already renders generically; text stays `anchorMode:'absolute'` so `resolveAnchor` needs no metrics. The ONLY non-app change is in `packages/interaction` (editor-chrome bbox). Confirm no `packages/runtime`/bundle regen is needed (state it).
- **Text metrics are an ESTIMATE** (pure `estimateTextBox`), editor-only; measured-getBBox is out of scope. Document "approximate" at the function.
- **Every mutating store action gates `isLockedInTree` FIRST** (before asset/field work), toast + no commit, with a lock test. `addTextObject` creates a new object (nothing to lock); the text-field setters mutate an existing asset's object → lock-gated.
- Active-scene routing: creation + edits go through `selectActiveScope`/`appendObjectToScene`/`replaceObjectInScene` (or the asset-update equivalent) so they work inside a symbol edit scope.
- Env: `node_modules/.bin/{vitest,tsc,eslint,playwright}` from repo root; NEVER `pnpm install`/`pnpm approve-builds`; revert stray `pnpm-workspace.yaml`. Fresh `useEditor.getState()` per test read. E2E stage queries scoped to `section[aria-label="Stage"]`.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Text bbox — `estimateTextBox` + `resolveObjectAnchor` branch

**Files:**
- Modify: `packages/interaction/src/snapping.ts` (+ its test): add `estimateTextBox(content: string, fontSize: number, textAnchor?: 'start'|'middle'|'end'): LocalRect` (pure; width = Σ char advance ≈ `content.length * fontSize * 0.6`, height = `fontSize`, x shifted by textAnchor: start→0, middle→−w/2, end→−w; y=0 top-left per `dominant-baseline: text-before-edge`; empty content → width 0). Add a text branch to `resolveObjectAnchor` (~:126) BEFORE the `return null`: `if (asset.kind === 'text') { const bbox = estimateTextBox(asset.content, asset.fontSize, asset.textAnchor); return { anchorX: obj.anchorX, anchorY: obj.anchorY, bbox }; }`. Read the vector/svg branches for the exact `LocalRect`/return shape.
- Modify: `packages/interaction/src/index.ts` if `estimateTextBox` should be exported (check whether tests import from the barrel).

**Interfaces:**
- Produces: `estimateTextBox` (Task 3 may reuse it for nothing — it's chrome-only). `resolveObjectAnchor` returning non-null for text → `objectAABB`/`entityAABB` (same file) light up automatically.

- [ ] TDD (estimateTextBox: length/fontSize scaling, textAnchor x-shift, empty content; resolveObjectAnchor text → non-null box; objectAABB/entityAABB text → non-null; non-text kinds byte-identical) → implement → gates (`node_modules/.bin/vitest run packages/interaction`, tsc, eslint). Confirm no engine/runtime change (no bundle regen). → commit `feat(interaction): text bbox estimate lights up selection/marquee/snap for text`.

---

### Task 2: Text tool + `addTextObject` store action + click-to-place

**Files:**
- Modify: `packages/editor-state/src/store-internals.ts` — add `'text'` to the `ToolMode` union (~:57) and to `SYMBOL_EDIT_TOOLS` (~:534); declare the `addTextObject(x: number, y: number): void` action signature.
- Modify: `packages/editor-state/src/store.ts` (+ `store` test) — implement `addTextObject(x, y)` mirroring `addVectorShape` (~:694): `createTextAsset({})` (engine, defaults content "Text"/fontSize 48/fill #000), `createSceneObject(asset.id, { name: 'Text '+(z+1), zOrder: z, anchorMode: 'absolute', anchorX: 0, anchorY: 0, base: { ...DEFAULT_TRANSFORM, x, y } })`, `commit(appendObjectToScene(project, selectActiveScope(s), asset, obj))`, then `set({ selectedObjectId: obj.id, selectedObjectIds: [obj.id], selectedKeyframe: null, activeTool: 'select' })`.
- Modify: `packages/ui-core/src/commands/registry.ts` — `tool('tool.text', 'Text tool', 'text', 't')` in the tool list (~:40).
- Modify: `apps/react/src/ui/components/Toolbar/ToolPalette.tsx` (+ test if TOOLS is asserted) — add `{ id: 'text', icon: 'text', label: 'Text' }`; `apps/react/src/ui/components/Toolbar/ToolbarIcons.tsx` — add `'text'` to `IconName` + a glyph in the `P` map (a simple "T" path or serif-T; match the inline-SVG style of siblings).
- Modify: `apps/react/src/ui/components/Stage/Stage.tsx` (+ `Stage.test.tsx`) — in `onBackgroundPointerDown` (~:666), add a branch analogous to eyedropper's background branch: `if (s.activeTool === 'text') { const p = clientToLocal(e.clientX, e.clientY); if (p) useEditor.getState().addTextObject(p.x, p.y); return; }` (addTextObject itself reverts the tool).

- [ ] TDD (store: addTextObject creates asset+object with the seeded fields, selects it, activeTool→select, one commit, in-symbol scope routing; registry: tool.text sets activeTool; Stage: text tool + background click → text object created+selected) → implement → gates (`node_modules/.bin/vitest run packages/editor-state packages/ui-core apps/react`, tsc, eslint) → commit `feat(editor): text tool — click-to-place text objects`.

---

### Task 3: Inspector text panel + field setters

**Files:**
- Modify: `packages/editor-state/src/store.ts` (+ test) — text-asset field setters, each **lock-gated FIRST**, active-scene routed, one commit: either a single `setTextAssetFields(patch: { content?; fontSize?; fill?; fontFamily?; textAnchor? })` or per-field setters (implementer's choice). Mutate the selected text object's ASSET (find it via the active scope's assets; replace in `project.assets`). NOTE: text asset fields are STATIC (no tracks/autoKey) — a plain asset replace + commit.
- Modify: `packages/ui-core/src/viewmodels/inspector.ts` (+ test) — add `InspectorTextVM { content; fontSize; fill; fontFamily; textAnchor }` populated when `asset.kind === 'text'` (beside the existing `textPath` block ~:545); intents for the setters.
- Modify: `apps/react/src/ui/components/Inspector/Inspector.tsx` (+ test) — a "Text" panel (`{textVm && (...)}`) slotted immediately BEFORE the `{textPath && (...)}` block: content input (aria-label `text content`), fontSize NumberField (aria-label `font size`, min 1), fill color input (aria-label `text fill`), fontFamily input (aria-label `font family`), textAnchor select (aria-label `text anchor`, options start/middle/end). Each commits via its intent.

- [ ] TDD (store: each setter mutates the asset, lock-gated (locked → toast + no commit), one commit; VM: text fields present for text object, absent otherwise; component: panel renders + edits dispatch) → implement → gates (`node_modules/.bin/vitest run packages/editor-state packages/ui-core apps/react`, tsc, eslint) → commit `feat(editor): inspector text panel — edit content/size/fill/font/anchor`.

---

### Task 4: E2E + full gates

**Files:**
- Create: `e2e/text-tool.spec.ts` (mirror `e2e/draw-vector.spec.ts` house style + the one-shot revert idiom from `e2e/style-tools.spec.ts`).

- [ ] Select the Text tool (`getByRole('button', { name: 'Text' })`), click the stage (single `page.mouse.click` at a computed offset) → assert a `section[aria-label="Stage"] ... text` element exists AND the Inspector shows the content field (`getByLabel('text content')`) AND Select is re-pressed (`aria-pressed='true'`); edit content via the field → the stage `<text>` updates; then the reachability proof — draw a line/pen path, select the text, bind via the Text-on-Path `attach to path` select → a `<textPath>` with a resolving href appears. FULL GATES: tsc, full `node_modules/.bin/vitest run`, eslint, full `node_modules/.bin/playwright test` incl. @portable (direct-vite workaround if `pnpm dev` webServer fails: start apps/react on 5173 + apps/svelte on 5174, then run); exact counts; clean `git status` → commit `test(e2e): text tool create + edit + bind-to-path reachability`.

---

## Out of scope (per spec)

Measured-getBBox precise bounds; resize/rotate/scale handles for text (+ fontSize-vs-scale decision); multiline/wrapped text; web fonts; per-glyph styling; rich text; DSL/MCP changes (agents already have add_text).
