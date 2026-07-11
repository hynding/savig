# Text on Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind text to a path (`textPath` on the text SceneObject) rendering via `<textPath>` over a world-space def, with `startOffset` animating through the generic `obj.tracks.textPathOffset`.

**Architecture:** Engine `resolveTextPath(project, textObj, time)` (cross-object, boolean-operand precedent) produces `{worldD, startOffset} | null`; consumed by renderLeaf (def + textPath markup, plain-text fallback), computeFrame (`FrameItem.textPathD`/`textPathStartOffset`), applyFrameToNodes (def-by-id + startOffset updates), and Stage JSX. Bound text's own transform IGNORED (motionPath precedent). New `AnimatableProperty 'textPathOffset'` rides the generic tracks. Inspector picker + detach; store bind/unbind.

**Tech Stack:** pnpm monorepo, TS strict, Vitest colocated, Playwright e2e, resvg (smoke test).

**Spec:** `docs/superpowers/specs/2026-07-11-text-on-path-design.md` (approved; Decisions 1–7 binding).

## Global Constraints

- **Parity:** absent `textPath` → all pipelines byte-identical. Dangling/ineligible binding → plain-text fallback (lazy; no pruning, no deletion blocking).
- The def is OURS: `savig-textpath-<renderId>`, `pathLength="1"`, world-space `d` (bound path's current-frame PathData through its FULL composed chain — group prefixes + own transform; reuse mapPoint/toWorld machinery). Bound text renders with identity transform (own base/tracks ignored while bound).
- `'textPathOffset'` joins `AnimatableProperty` (additive; the primitives precedent) — sampled ONLY at the resolveTextPath seam, NOT the generic transform/geometry loops. Track wins over `textPath.startOffset` base.
- `resolveTextPath` returns null unless: textObj has `textPath`, target exists in the scene scope, target's asset is vector `shapeType 'path'`.
- Engine changes touch the runtime bundle graph (frame.ts consumes the helper) — regen `(cd packages/runtime && node scripts/build-runtime.mjs)` in the same commits; regen-and-diff verdicts stated.
- Env: `node_modules/.bin/{vitest,tsc,eslint,playwright}` from repo root; NEVER `pnpm install`/`pnpm approve-builds`; revert stray `pnpm-workspace.yaml`. Fresh `useEditor.getState()` per test read.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Engine — model, `resolveTextPath`, duration, resvg smoke

**Files:**
- Modify: `packages/engine/src/types.ts` (`textPath?: { pathObjectId: string; startOffset: number }` on SceneObject next to motionPath; `'textPathOffset'` in AnimatableProperty — mirror how PrimitiveProperty was added)
- Create: `packages/engine/src/textPath.ts` + test (`resolveTextPath(project: Project, textObj: SceneObject, time: number): { worldD: string; startOffset: number } | null` — resolve target in `project.objects`; sample its state (`sampleObject` + primitive spec threading — mirror computeFrame's call); take `state.path ?? asset.path` (+ boolean? a live-boolean bound path: use resolveBooleanRings ring 0? — SIMPLER: bound target with `obj.boolean` → null (fallback) v1, document); map nodes+handles through the target's composed world transform (find/reuse the groupTransform mapPoint chain the shape-builder punch used — `toWorld`/`mapPoint`); `pathToD` the transformed PathData; offset = `interpolate(textObj.tracks.textPathOffset, time)` when non-empty else `textPath.startOffset`, wrapped mod 1? NO — clamp/wrap NOT applied; raw value, browsers handle out-of-range)
- Modify: `packages/engine/src/index.ts`; `packages/engine/src/duration.ts` (nothing — tracks loop is generic; ADD A PIN TEST ONLY)
- resvg smoke: a test in `packages/core/src/node/` (or wherever render.ts tests live) rasterizing a doc with the textPath markup — assert it renders WITHOUT throwing and record (in the report) whether glyphs follow the path (pixel-diff vs plain text if cheap, else visual verdict deferred to the report)
- Regen bundle (textPath.ts consumed by frame.ts in Task 2 — regen HERE only if index/barrel inclusion changes the bundle; verdict either way)

**Interfaces:** Tasks 2–4 rely on `resolveTextPath`'s exact signature and the `'textPathOffset'` member.

- [ ] TDD per the spec's engine list → implement → gates (`vitest run packages/engine packages/core`, tsc, eslint) + regen verdict → commit `feat(engine): textPath model + resolveTextPath world-space resolution`.

---

### Task 2: Render pipelines — static, runtime, Stage

**Files:**
- Modify: `packages/services/src/export/renderDocument.ts` (text branch ~:481-489: when `resolveTextPath` non-null → emit `<defs><path id="savig-textpath-<renderId>" d pathLength="1"/></defs>` (into the shared defs collection — gradient-def precedent) + `<g data-savig-object …identity transform…><text …><textPath href="#…" startOffset="…">content</textPath></text></g>`; escapeAttr everywhere; else today's markup byte-identical)
- Modify: `packages/runtime/src/frame.ts` (`FrameItem.textPathD?/textPathStartOffset?`; computeFrameForScene resolves via the helper for text leaves with bindings — note the leaf's own transform must be IDENTITY while bound: emit `transform: ''`? Check applyFrameToNodes sets transform unconditionally — emit the identity/groupPrefix-only transform the initial markup used; applyFrameToNodes: update `#savig-textpath-<objectId>` def's `d` (root lookup — gradient applyGradientToElement precedent) + `node.querySelector('textPath')` startOffset) + regen bundle SAME commit
- Modify: `apps/react/src/ui/components/Stage/Stage.tsx` (text JSX branch ~:1319-1347: same structure driven by the same helper; defs rendered adjacent — check how gradient defs render in Stage JSX and mirror)
- Tests: renderDocument (structure + fallback + parity), frame (fields only-when-bound; applicator updates both attrs in a jsdom fixture), Stage (bound text renders textPath; offset changes on seek)

- [ ] TDD → implement → gates (`vitest run packages/services packages/runtime apps/react`, tsc, eslint; bundle regen in-commit) → commit `feat(render): textPath def + live startOffset across static/runtime/stage`.

---

### Task 3: Store + Inspector

**Files:**
- Modify: `packages/editor-state/src/store-internals.ts` + `store.ts`: `bindTextPath(pathObjectId: string)` (gates: selected is text-asset object; target eligible — resolve via the same rules as resolveTextPath minus time; active-scene routed; sets `textPath: { pathObjectId, startOffset: 0 }`), `unbindTextPath()` (clears field + strips `tracks.textPathOffset` — orphan-duration precedent). Offset editing: VERIFY `setProperty('textPathOffset', v)` works post-primitives (generic tracks write, autoKey-gated — if setProperty requires autoKey for non-group and no base fallback exists for non-transform members, add a thin `setTextPathOffset(v)` mirroring setPrimitiveParam's autoKey duality: ON→keyframe, OFF→`textPath.startOffset` base write).
- Modify: `packages/ui-core/src/viewmodels/inspector.ts` (text VM section: `pathTargets: {id,name}[]` (eligible paths in scope, swapTargets precedent), current binding name, offset value (track-sampled ?? base)) + intents
- Modify: `apps/react/src/ui/components/Inspector/Inspector.tsx` (text panel: "Attach to path" select aria-label `attach to path`, Detach button aria-label `detach from path`, offset NumberField aria-label `path offset`; hint line "Bound text ignores its own transform")
- Tests: store (gates, bind/unbind round-trip + track strip, offset setter autoKey duality, in-symbol), VM (targets filtering), Inspector component (bind → select → store effect; detach; offset commit)

- [ ] TDD → implement → gates (`vitest run packages/editor-state packages/ui-core apps/react`, tsc, eslint) → commit `feat(editor): text-on-path binding UX + offset editing`.

---

### Task 4: E2E + full gates

**Files:**
- Create: `e2e/text-on-path.spec.ts`

- [ ] House style: add a text object (FIND the flow — grep e2e/ for existing text creation; if none exists in e2e, check the Toolbar/command for "text" — the M5 text feature shipped an editor flow; mirror it), draw a pen/line path, select the text, bind via `attach to path` select → stage text contains `<textPath>` with a resolving href and the text visually relocated (assert the textPath element + href attribute); with autoKey ON set `path offset` at t=0 and after a ruler click → scrub → the `startOffset` attribute differs between positions; detach → plain `<text>` again. FULL GATES (tsc, full vitest, eslint, full playwright incl. @portable; workspace check; exact counts) → commit `test(e2e): text-on-path bind, animated offset, detach`.

---

## Out of scope (per spec)

Text bbox/metrics; side/method/spacing; rect/ellipse targets; live-boolean bound targets (fallback v1); binding DSL field; per-glyph effects.
