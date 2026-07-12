# Follow-ups Batch 2 Implementation Plan (def isolation + tint XSS + carry-forwards)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the editor's duplicate-SVG-def-id collisions (thumbnails vs Stage), fix the tint/clip injection surfaces (Stage HIGH XSS + the same unescaped interpolation in the export path), and land batch-1's carry-forward micro-fixes.

**Architecture:** Thumbnails move from inlined `dangerouslySetInnerHTML` markup to data-URI `<img>` (browser-level isolation kills every def-id family collision at once and deletes 2 of the app's 3 innerHTML sites). Stage's remaining innerHTML shrinks to the already-sanitized svg-asset defs: tint filters and clip paths become JSX components (GradientEl precedent). Export-side tint/clip interpolation gains `escapeAttr` (gradient/textpath discipline). Seam anchors verified by survey 2026-07-11.

**Tech Stack:** pnpm monorepo, TS strict, Vitest colocated, Playwright e2e.

## Global Constraints

- **Parity:** benign values must render byte-identically (escapeAttr rewrites only `& < > " '` — numeric/hex-only values unchanged; pin it). Thumbnails must look identical (same markup, new transport).
- **Security framing:** defense at the SINK (JSX auto-escape / escapeAttr), not input validation — loadSavig deep validation stays out of scope (documented decision; isProjectShape is shape-only).
- Runtime bundle: `packages/engine` untouched except textPath.ts (symbolHasBoundText hidden-gate) → regen-and-diff in that commit. services/apps changes don't touch the bundle.
- Env: `node_modules/.bin/{vitest,tsc,eslint,playwright}` from repo root; NEVER `pnpm install`/`pnpm approve-builds`; revert stray `pnpm-workspace.yaml`. Fresh `useEditor.getState()` per test read. E2E stage queries scoped to `section[aria-label="Stage"]`.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Injection surfaces — Stage tint/clip JSX + export escapeAttr

**Files:**
- Modify: `apps/react/src/ui/components/Stage/Stage.tsx` (+ `Stage.test.tsx`)
- Modify: `packages/services/src/export/renderDocument.ts` (+ `renderDocument.test.ts`)

**Changes:**
1. **Stage tint filters → JSX.** Replace the `tintFilterDefs` string memo (Stage.tsx:231-247) with a `TintFilterEl({ id, color, amount })` component rendered inside `<defs>` (exact GradientEl precedent, Stage.tsx:54-67): `<filter id x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB"><feFlood floodColor={color} floodOpacity={amount} result="flood"/><feComposite in="flood" in2="SourceGraphic" operator="in" result="tintLayer"/><feBlend in="SourceGraphic" in2="tintLayer" mode="multiply"/></filter>` — attribute-for-attribute identical output for benign values (note the camelCase JSX props). Dedup by tintId as today.
2. **Stage clip paths → JSX.** Replace `clipPathDefs` (Stage.tsx:212-227) with `ClipPathEl({ id, width, height, transform })`: `<clipPath id clipPathUnits="userSpaceOnUse"><rect x={0} y={0} width height transform/></clipPath>`.
3. The `<defs dangerouslySetInnerHTML={{ __html: defs + clipPathDefs + tintFilterDefs }}/>` (Stage.tsx:1123) shrinks to `__html: defs` ONLY (buildDefs' sanitized svg-asset content legitimately needs parsed-markup injection); the JSX elements render as siblings inside the same `<defs>`... React cannot mix children with dangerouslySetInnerHTML on one element — render TWO defs elements: `<defs dangerouslySetInnerHTML={{__html: defs}}/><defs>{clipEls}{tintEls}</defs>` (multiple `<defs>` are valid SVG).
4. **Export-side escaping** (renderDocument.ts): tint filter block (:182-197) — `escapeAttr` on the id, `flood-color`, `flood-opacity`; `buildClipPathDefs` (:420-438) — `escapeAttr` on the id and `clipTransform`. Match the gradient/textpath escapeAttr discipline already in the file.
5. **XSS regression tests (both surfaces):** an object with `tint: { color: '"><image href=x onerror=alert(1)>', amount: 1 }` — Stage.test.tsx: render → assert NO `image` element exists in the container and the feFlood's `flood-color` ATTRIBUTE equals the raw string (React escaped it into an attribute, not markup); renderDocument.test.ts: exported string contains the escaped entity sequence (`&quot;&gt;...`) and no raw `<image`. Same for a hostile `clipTransform`. **Parity pins:** benign tint (hex color) Stage output attribute-identical to before (assert the filter structure + values); benign export byte-identical (existing tint structural tests at :903-1003 must stay green UNMODIFIED — they pin the benign shape).

- [ ] TDD (hostile-input tests FIRST — they must fail against current code, proving exploitability at the DOM level in jsdom) → implement → gates (`node_modules/.bin/vitest run apps/react packages/services`, tsc, eslint) → commit `fix(security): tint/clip defs via JSX + export escapeAttr (closes the Stage tint XSS)`.

---

### Task 2: Thumbnail isolation — data-URI `<img>` + SceneStrip memoization

**Files:**
- Modify: `apps/react/src/ui/components/AssetPanel/thumbnailSvg.ts` (+ `thumbnailSvg.test.ts`)
- Modify: `apps/react/src/ui/components/AssetPanel/SymbolThumbnail.tsx`, `apps/react/src/ui/components/SceneStrip/SceneStrip.tsx` (+ their tests / `AssetPanel.test.tsx`)
- Modify: `apps/react/src/ui/components/SceneStrip/SceneStrip.module.css` (:31-47), `apps/react/src/ui/components/AssetPanel/AssetPanel.module.css` (:23-36)

**Changes:**
1. Add `svgDataUri(svg: string): string` to thumbnailSvg.ts: `'data:image/svg+xml;utf8,' + encodeURIComponent(svg)` (new pattern — no repo precedent; keep it in this one module).
2. `SymbolThumbnail.tsx`: replace the `dangerouslySetInnerHTML` span with `<img className={styles.thumb} src={svgDataUri(svg)} alt="" data-testid="symbol-thumb" aria-hidden/>` (memo stays).
3. `SceneStrip.tsx` (:33): extract a `SceneThumb({ scene, assets, meta })` component that `useMemo`s `sceneThumbnailSvg` on `[scene, assets, meta]` (the SymbolThumbnail pattern — fixes the every-store-tick full-export-render perf bug: today the unmemoized call reruns per tile on every playhead/selection/pan tick) and renders the `<img>`; the button wraps it.
4. CSS: retarget `.thumb :global(svg)` rules to the `<img>` (`.thumb img { width:100%; height:100%; display:block; }` or size the img directly) — the survey confirmed the export SVG has a viewBox (intrinsic aspect ratio) so `<img>` sizing behaves.
5. Keep the `data-savig-object` strip in thumbnailSvg.ts (smaller URIs; harmless).
6. **Collision-kill pin test:** mount Stage + SceneStrip (or Stage + AssetPanel with a symbol) for a project with a gradient fill and a tinted instance → assert every `id` in `document` is unique (`document.querySelectorAll('[id]')` set size === list length), and thumbnails contain `<img>` with `src` starting `data:image/svg+xml` and NO inline `<svg>` defs. **Memo pin:** rerender SceneStrip with only `time` changed → `sceneThumbnailSvg` not recalled (spy/mock module).
7. **Perf sanity note in report:** measure a representative `sceneThumbnailSvg(...).length` and state the data-URI size (unverified-budget flag from the survey).

- [ ] TDD → implement → gates (`node_modules/.bin/vitest run apps/react`, tsc, eslint) → commit `fix(editor): thumbnails render via data-URI img — def-id isolation + per-tile memoization`.

---

### Task 3: Batch-1 carry-forward micro-fixes

**Files:**
- Modify: `packages/editor-state/src/store.ts` (+ `store.primitives.test.ts`): `setPrimitiveParam` (:790) — early-return when `obj.shapeTrack?.length` (a morphing object's primitive params are shadowed; writing them recreates the orphan the shapeTrack-add strip removes). Silent return matches the function's existing gate style. Tests: autoKey ON + shapeTrack non-empty → no track written, no commit; shapeTrack empty → unchanged behavior (parity).
- Modify: `packages/mcp/src/tools.ts` (+ test if description is asserted anywhere): `set_keyframe` description (:166) appends: `Primitive-property keyframes (sides/starPoints/innerRatio/primitiveRotation) on an object with a shape morph track are shadowed (morph wins) and only inflate duration.`
- Modify: `apps/react/src/ui/components/Inspector/Inspector.tsx` (+ Inspector.test.tsx): blend-steps raw `<input>` (:143-149, local `blendSteps` state :89) → the shared `NumberField` (Inspector.tsx:22, commit-on-blur/Enter, self-labeling `blend steps`) with `min 1` and a 100 cap applied in the commit handler (`setBlendSteps(Math.min(100, Math.max(1, Math.round(n))))`) — closes the "editor is the loosest untrusted tier" asymmetry vs the MCP 1..100 clamp. Existing blend e2e uses the `blend steps` aria-label — NumberField self-generates `id`/`aria-label` from its label, so `blend steps` label preserves the e2e selector; VERIFY e2e/blend.spec.ts still passes (it types a value + clicks Blend — commit-on-blur semantics may need the e2e to press Enter/blur; if the e2e breaks, adjust the E2E to blur — the spec change is the fix, not the test weakening... state what you did).
- Modify: `packages/engine/src/textPath.ts` (+ test): `symbolHasBoundText` direct check (:82) → `if (obj.textPath && !obj.hidden) return true;` (a hidden bound-text object never renders in the static def → cannot desync; aligns with the hidden-gated nested descent). Regen bundle same commit (textPath.ts is in the graph via resolveTextPath) + verdict. Test: symbol whose ONLY bound text is hidden → static-optimizable again; visible → still gated.

- [ ] TDD → implement → gates (`node_modules/.bin/vitest run packages/editor-state packages/mcp apps/react packages/engine packages/services`, tsc, eslint) + regen verdict → commit `fix(follow-ups): shadowed-primitive write guard, MCP note, blend-steps NumberField clamp, hidden-text static gate`.

---

### Task 4: E2E + full gates

**Files:**
- Modify: `e2e/scenes.spec.ts` or `e2e/symbols.spec.ts` (whichever has the closest thumbnail-adjacent flow — check both): add a pin that a SceneStrip tile (or AssetPanel symbol thumb) renders an `img[src^="data:image/svg+xml"]` and the page has no duplicate element ids while the Stage shows a gradient-filled object (evaluate `document.querySelectorAll('[id]')` uniqueness via page.evaluate).
- Verify e2e/blend.spec.ts against the NumberField swap (Task 3) — fix the interaction (fill + blur/Enter) if needed, without weakening assertions.

- [ ] House style; FULL GATES: tsc, full `node_modules/.bin/vitest run`, eslint, full `node_modules/.bin/playwright test` incl. @portable (direct-vite workaround if `pnpm dev` webServer fails: `cd apps/react && ../../node_modules/.bin/vite --port 5173`, same for svelte on 5174); exact counts; clean `git status` → commit `test(e2e): thumbnail isolation pin + unique-id sweep`.

---

## Out of scope

loadSavig deep schema validation (sink defense chosen; documented); add-text tool (batch 3); thumbnail live-update-on-animation (thumbnails stay t=0 frozen — unchanged behavior).
