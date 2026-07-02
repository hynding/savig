# Framework-Agnostic Restructure — Slice 4: `@savig/ui-core/viewmodels` (L1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extract per-panel PRESENTATION LOGIC out of the React panel components into framework-neutral **view-models** (pure `state → descriptor`) + **intents** (thin action wrappers) in a new `@savig/ui-core` package, and refactor each panel to consume them. Behavior-preserving. This shrinks the eventual Svelte panels to thin templates.

**Architecture:** New package `@savig/ui-core` (deps: `@savig/editor-state`, `@savig/engine`, `@savig/interaction`) with a `viewmodels/` subpath. Each substantial panel gets `xyzViewModel(s: EditorState): XyzVM` (pure — derivations, formatted values, enabled flags, option lists, selection summaries) and `xyzIntents(store): {...}` (thin wrappers over store actions). The React panel calls `const vm = useEditor(xyzViewModel)` and renders `vm` + calls `intents`; all *logic* that would be identical in another framework moves to the view-model.

**Tech Stack:** pnpm workspace, TypeScript, Vite/Vitest, Playwright, zustand v5.

## Global Constraints

- **Zero behavior change.** Gate per task: ~1,711 unit + 109 e2e + `tsc --noEmit` + `pnpm lint`, all green. No new *product* behavior. New view-model unit tests ARE encouraged (pure functions are cheap to test) but must not change component behavior.
- **View-models are framework-neutral AND pure:** a view-model imports only `@savig/editor-state` (state type + selectors), `@savig/engine`, `@savig/interaction`. NO react, NO `apps/**`, and NO module-level mutable state/memo. It returns a fresh descriptor each call. `intents` take the vanilla `store` (or its `getState`) — they must NOT import React or the app.
- **Stabilization convention (decided in Task 1):** React components select a view-model via the **`useEditorVM(vm)`** helper in `apps/react/src/ui/store/store.ts` — a per-component `useRef` memo keyed on the state reference that satisfies `useSyncExternalStore`'s referential-stability requirement (a pure fresh-object VM would otherwise infinite-loop). Do NOT put a memo inside the view-model, and do NOT use `useShallow` (it's shallow — a VM with freshly-allocated nested fields would still loop). Every panel in Tasks 2–4 uses `useEditorVM`.
- **The test for "extract it":** a line that would be identical in Svelte/Vue (a derivation, a formatted string, an eligibility flag, a dropdown option list, `sampleObject(obj,time)`) is presentation logic → moves to the view-model. Markup, JSX, refs, local draft-input state → stays in the component.
- **Scope (decided from a panel inventory):** extract view-models for the 7 panels with real logic — Inspector, Timeline, LayersPanel, AssetPanel, SceneStrip, PrimitiveOptions, TransportControls. **Skip** the trivial three (Toast, ThemeToggle, FileToolbar — near-zero logic; a view-model would be empty ceremony). **EasingEditor is deferred to Slice 5** (it's a self-contained curve-drag widget = an L2 controller, not an L1 presenter).
- `@savig/ui-core` is ONE package with a `viewmodels/` dir now; a `controllers/` dir is added in Slice 5. Consumers import from `@savig/ui-core` (barrel) or `@savig/ui-core/viewmodels/<panel>`.

---

### Task 1: Create `@savig/ui-core` + extract the Inspector view-model (pattern exemplar)

**Files:**
- Create: `packages/ui-core/package.json`, `packages/ui-core/src/index.ts`, `packages/ui-core/src/viewmodels/inspector.ts`, `packages/ui-core/src/viewmodels/inspector.test.ts`
- Modify: `apps/react/src/ui/components/Inspector/Inspector.tsx` (consume the VM + intents), `tsconfig.json`/`vitest.config.ts`/`apps/react/vite.config.ts` (alias), `apps/react/package.json` (dep)

**Interfaces:**
- Produces: `@savig/ui-core` package; `inspectorViewModel(s: EditorState): InspectorVM` + `inspectorIntents(store)`; the `@savig/ui-core` alias. This is the reference pattern for Tasks 2–4.

- [ ] **Step 1: Scaffold the package.** `mkdir -p packages/ui-core/src/viewmodels`. Create `packages/ui-core/package.json`:

```json
{
  "name": "@savig/ui-core",
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts", "./*": "./src/*.ts", "./viewmodels/*": "./src/viewmodels/*.ts" },
  "dependencies": {
    "@savig/editor-state": "workspace:*",
    "@savig/engine": "workspace:*",
    "@savig/interaction": "workspace:*"
  }
}
```
Create `packages/ui-core/src/index.ts` re-exporting view-models as they're added: `export * from './viewmodels/inspector';` (append one line per panel in later tasks).

- [ ] **Step 2: Add the `@savig/ui-core` alias** to the three surfaces (single entry each): tsconfig `paths` `"@savig/ui-core": ["packages/ui-core/src/index.ts"]` (+ optionally `"@savig/ui-core/*": ["packages/ui-core/src/*.ts"]`); `vitest.config.ts` + `apps/react/vite.config.ts` alias `'@savig/ui-core': r('.../packages/ui-core/src/index.ts')`. Add `"@savig/ui-core": "workspace:*"` to `apps/react/package.json` deps.

- [ ] **Step 3: Read `Inspector.tsx` and extract its presentation logic** into `packages/ui-core/src/viewmodels/inspector.ts`. Move the pure derivations currently computed inline in the component — e.g. `round()`, `correspondenceSummary()`, the eligibility computations (`someGrouped`, `movableCount`, `eligibleForBool`, `canCreateSymbol`, `hasVectorLeaf`), `sampled = sampleObject(obj, time)`, kind resolution (empty/single/multi), formatted numeric fields, and dropdown/option lists — into a pure `inspectorViewModel(s: EditorState): InspectorVM` returning a descriptor object. Define `InspectorVM` as an explicit interface. Add `inspectorIntents(store: StoreApi<EditorState>)` returning thin wrappers for the actions the Inspector dispatches (e.g. `setPaint`, `booleanOp`, `createSymbol`, numeric-field commits) — each just calls `store.getState().<action>(...)`. Do NOT move the `NumberField` component, `renderPaintRow`/`renderGradientEditor` JSX builders, local draft-input `useState`, or any refs — those stay in the component.

- [ ] **Step 4: Write `inspector.test.ts`** — unit tests for `inspectorViewModel` over representative states (empty selection, single object, multi-select, group, boolean-eligible, symbol-eligible), asserting the descriptor fields. Pure-function tests; no React.

- [ ] **Step 5: Refactor `Inspector.tsx`** to consume the VM: `const vm = useEditor(inspectorViewModel)` (selector form) and `const intents = useMemo(() => inspectorIntents(store), [])` (import `store` from `@savig/editor-state` via the app — or expose a stable intents singleton). Replace the inlined logic with reads of `vm.*` and calls to `intents.*`. The markup and local input state stay. Net: Inspector.tsx shrinks substantially; no visible behavior change.

- [ ] **Step 6: Full gate.**

Run: `pnpm install && pnpm typecheck && pnpm test && pnpm lint && pnpm e2e`
Expected: `tsc --noEmit` clean; unit count = prior 1,711 + the new inspector VM tests; lint clean; 109 e2e green (Inspector still works identically).

- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "feat(ui-core): @savig/ui-core + Inspector view-model (L1 pattern exemplar)"
```

---

### Task 2: Timeline view-model

**Files:** Create `packages/ui-core/src/viewmodels/timeline.ts` (+ `.test.ts`); modify `Timeline.tsx`, `packages/ui-core/src/index.ts` (append export).

- [ ] **Step 1:** Extract `timelineViewModel(s): TimelineVM` — the 20 store-derived values Timeline computes (track rows, keyframe positions/times, playhead position, per-object lane data, lock-aware flags, formatted time labels) and `timelineIntents(store)` (seek, add/move/delete keyframe, toggle, etc.). Keep the scrubbing pointer handling in the component for now (that becomes an L2 controller in Slice 5 — leave a note).
- [ ] **Step 2:** Unit-test `timelineViewModel` over a project with keyframes.
- [ ] **Step 3:** Refactor `Timeline.tsx` to consume vm + intents; markup + pointer handlers stay.
- [ ] **Step 4:** Gate: `pnpm typecheck && pnpm test && pnpm lint && pnpm e2e` all green.
- [ ] **Step 5:** Commit `feat(ui-core): Timeline view-model`.

---

### Task 3: LayersPanel + SceneStrip view-models

**Files:** Create `viewmodels/layersPanel.ts`, `viewmodels/sceneStrip.ts` (+ tests); modify `LayersPanel.tsx`, `SceneStrip.tsx`, `index.ts`.

- [ ] **Step 1:** `layersPanelViewModel(s): LayersPanelVM` — the layer tree rows (id, depth, name, visibility/lock flags, isGroup, selection state) + `layersPanelIntents(store)` (select, rename, toggle-visible/lock, reorder/reparent dispatch). Keep drag-reorder pointer logic in the component (L2 later — note it).
- [ ] **Step 2:** `sceneStripViewModel(s): SceneStripVM` — scene thumbnails/labels/durations/active-id/transition badges + `sceneStripIntents(store)` (add/select/rename/setDuration/reorder/delete/setTransition).
- [ ] **Step 3:** Unit-test both view-models.
- [ ] **Step 4:** Refactor both components to consume vm + intents.
- [ ] **Step 5:** Gate all green. Commit `feat(ui-core): LayersPanel + SceneStrip view-models`.

---

### Task 4: AssetPanel + PrimitiveOptions + TransportControls view-models

**Files:** Create `viewmodels/{assetPanel,primitiveOptions,transportControls}.ts` (+ tests); modify the three components, `index.ts`.

- [ ] **Step 1:** `assetPanelViewModel(s)` (asset list rows, active-asset, symbol vs vector filter, thumbnail refs) + intents (import/select/rename/delete/instantiate). Keep file-read + drag-to-place in the component (drag = L2 later).
- [ ] **Step 2:** `primitiveOptionsViewModel(s)` (the 13 store-read primitive params → current values + which controls are visible for the active tool) + intents (setPrimitiveParam).
- [ ] **Step 3:** `transportControlsViewModel(s)` (isPlaying, formatted time/duration, loop flag) + intents (play/pause/seek/toggle-loop). (Reuse `formatTime` if it's already a pure helper.)
- [ ] **Step 4:** Unit-test the three view-models. Refactor the three components.
- [ ] **Step 5:** Gate all green. Commit `feat(ui-core): AssetPanel + PrimitiveOptions + TransportControls view-models`.

---

## Self-Review (against constraints)

- **Coverage:** 7 substantial panels across Tasks 1–4; trivial three (Toast/ThemeToggle/FileToolbar) explicitly skipped with rationale; EasingEditor deferred to Slice 5. ✅
- **Neutrality:** each view-model imports only editor-state/engine/interaction; intents take the vanilla store; no react/app imports. ✅
- **Behavior-preservation:** each task keeps markup + local input/pointer state in the component; only pure logic moves; gate includes e2e. Pointer/drag/scrub interaction explicitly left for Slice 5 (L2 controllers), noted per panel. ✅
- **Placeholder scan:** Tasks 2–4 describe the VM contents by naming the specific derivations to move; the implementer reads each component to enumerate exact fields (the logic is judgment-driven, not verbatim-copyable, so per-panel discovery is expected and correct). No TBDs in the process.
- **Pattern consistency:** Task 1 (Inspector) is the exemplar; Tasks 2–4 mirror its `xyzViewModel`/`xyzIntents` shape + `index.ts` append + alias (already added in Task 1). ✅
