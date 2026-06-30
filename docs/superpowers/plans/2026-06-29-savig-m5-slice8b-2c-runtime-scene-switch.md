# M5 Slice 8b-2c — Runtime scene-switching + bundle regen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the standalone runtime (and the shared frame-apply path) switch scenes by visibility — at master time `t`, show only the active scene's `<g data-savig-scene>`, animate only its nodes, and apply its per-scene camera. Regenerate the runtime bundle.

**Architecture:** Add one shared helper `applyProjectFrame(root, nodes, project, time)` to `src/runtime/frame.ts` that both the runtime player and (in 8b-2d) the headless raster call, so multi-scene playback logic lives in exactly one place. The runtime's per-frame `apply` delegates to it. Single-scene path is unchanged (no `[data-savig-scene]` groups → the helper falls back to today's `applyFrameToNodes` + `applyCamera`).

**Tech Stack:** TypeScript strict, Vitest, esbuild (`node scripts/build-runtime.mjs`). No deps.

## Global Constraints

- **Parity:** for a single-scene project (no `scenes`, no `[data-savig-scene]` groups), runtime behavior MUST be byte-identical — same `applyFrameToNodes(computeFrame)` + `applyCamera`.
- **Active-scene only:** at time `t`, `applyProjectFrame` shows only the active scene group (`display:''`), hides the rest (`display:'none'`), runs `applyFrameToNodes(nodes, computeFrame(project, t))` (which already returns only the active scene's prefixed items, 8b-1b), and applies the active scene's camera via `computeSceneCameraTransform` scoped to that scene's `[data-savig-camera]` element.
- **Bundle regen:** after editing `src/runtime/index.ts`/`frame.ts`, run `node scripts/build-runtime.mjs` and commit the regenerated `src/runtime/runtimeSource.generated.ts`. (No freshness test exists; regen keeps source==bundle and is required for the multi-scene runtime to actually ship in exports.)
- Depends on 8b-1a (`sceneAtTime`), 8b-1b (scene-aware `computeFrame`), 8b-2b (`computeSceneCameraTransform`, `<g data-savig-scene>` export).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/runtime/frame.ts` | `applyProjectFrame(root, nodes, project, time)` shared helper | Modify |
| `src/runtime/frame.test.ts` | jsdom test of `applyProjectFrame` scene toggling | Modify |
| `src/runtime/index.ts` | runtime `apply` delegates to `applyProjectFrame` | Modify |
| `src/runtime/runtimeSource.generated.ts` | regenerated bundle | Modify (generated) |

---

## Task 1: `applyProjectFrame` shared helper

**Files:** Modify `src/runtime/frame.ts`, `src/runtime/frame.test.ts`

**Interfaces:**
- Consumes: `computeFrame`, `applyFrameToNodes`, `applyCamera` (existing in frame.ts); `sceneAtTime`, `computeSceneCameraTransform` from `../engine`.
- Produces: `export function applyProjectFrame(root: ParentNode, nodes: Map<string, Element>, project: Project, time: number): void`.

- [ ] **Step 1: Write the failing test** — append to `frame.test.ts`. (Build a tiny jsdom SVG with two `[data-savig-scene]` groups, each containing a `[data-savig-object]` node; assert toggling.)

```ts
import { JSDOM } from 'jsdom'; // already a dep (used by core/render). If the import path differs in
// this test file, mirror how core/render.test.ts constructs a JSDOM. Otherwise use the project's
// existing jsdom test setup (vitest environment may already provide document).

describe('applyProjectFrame — scene visibility toggling (8b-2c)', () => {
  function buildDom() {
    const dom = new JSDOM(`<!DOCTYPE html><body><svg>
      <g data-savig-scene="scA"><g data-savig-object="scA:oa"></g></g>
      <g data-savig-scene="scB" style="display:none"><g data-savig-object="scB:ob"></g></g>
    </svg></body>`);
    const svg = dom.window.document.querySelector('svg')!;
    const nodes = new Map<string, Element>();
    svg.querySelectorAll('[data-savig-object]').forEach((n) => nodes.set(n.getAttribute('data-savig-object')!, n));
    return { svg, nodes };
  }
  function multi() {
    const a = createVectorAsset('rect', { id: 'aRect' });
    const b = createVectorAsset('rect', { id: 'bRect' });
    return { ...createProject(), assets: [a, b], objects: [], scenes: [
      { id: 'scA', name: 'A', objects: [createSceneObject('aRect', { id: 'oa' })], duration: 2 },
      { id: 'scB', name: 'B', objects: [createSceneObject('bRect', { id: 'ob' })], duration: 2 },
    ] };
  }

  it('shows the active scene and hides the others at master time t', () => {
    const { svg, nodes } = buildDom();
    const project = multi();
    applyProjectFrame(svg, nodes, project, 0.5); // scene A active
    expect((svg.querySelector('[data-savig-scene="scA"]') as HTMLElement).style.display).toBe('');
    expect((svg.querySelector('[data-savig-scene="scB"]') as HTMLElement).style.display).toBe('none');
    applyProjectFrame(svg, nodes, project, 2.5); // scene B active
    expect((svg.querySelector('[data-savig-scene="scB"]') as HTMLElement).style.display).toBe('');
    expect((svg.querySelector('[data-savig-scene="scA"]') as HTMLElement).style.display).toBe('none');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm test src/runtime/frame.test.ts` → FAIL (`applyProjectFrame` not exported).

- [ ] **Step 3: Implement** — add to `frame.ts` (and add `sceneAtTime`, `computeSceneCameraTransform` to the `../engine` import):

```ts
/** Apply a master-time frame to a (possibly multi-scene) live SVG. Single-scene (no [data-savig-scene]
 *  groups / no project.scenes): identical to today (applyFrameToNodes + applyCamera). Multi-scene:
 *  show only the active scene group, animate its nodes (computeFrame already returns only the active
 *  scene's prefixed items), and apply the active scene's camera. Shared by the runtime player and the
 *  headless raster so multi-scene playback lives in one place. */
export function applyProjectFrame(root: ParentNode, nodes: Map<string, Element>, project: Project, time: number): void {
  applyFrameToNodes(nodes, computeFrame(project, time));
  if (!project.scenes) {
    applyCamera(root, project, time);
    return;
  }
  const { primary } = sceneAtTime(project, time);
  const groups = root.querySelectorAll('[data-savig-scene]');
  let activeGroup: Element | null = null;
  groups.forEach((g) => {
    const isActive = g.getAttribute('data-savig-scene') === primary.scene.id;
    (g as unknown as { style: CSSStyleDeclaration }).style.display = isActive ? '' : 'none';
    if (isActive) activeGroup = g;
  });
  const camEl = activeGroup ? (activeGroup as Element).querySelector('[data-savig-camera]') : null;
  if (camEl) {
    const t = computeSceneCameraTransform(primary.scene.camera, project.meta.width, project.meta.height, primary.localTime);
    if (t !== null) camEl.setAttribute('transform', t);
  }
}
```

- [ ] **Step 4: Run** — `pnpm test src/runtime/frame.test.ts && pnpm typecheck` → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(8b-2c): applyProjectFrame shared multi-scene apply helper"`

---

## Task 2: Runtime delegates to `applyProjectFrame`; regenerate bundle

**Files:** Modify `src/runtime/index.ts`, regenerate `src/runtime/runtimeSource.generated.ts`

- [ ] **Step 1: Update the runtime `apply`** — in `src/runtime/index.ts` `create()`, replace the per-frame body:

```ts
const apply = (time: number): void => {
  applyFrameToNodes(nodes, computeFrame(project, time));
  applyCamera(svg, project, time);
};
```

with:

```ts
const apply = (time: number): void => {
  applyProjectFrame(svg, nodes, project, time);
};
```

and update the import in `index.ts` to bring in `applyProjectFrame` (drop `applyFrameToNodes`/`applyCamera` from the import if now unused — check; `applyFrameToNodes` may still be referenced elsewhere). The node map built once from `[data-savig-object]` already contains all scenes' (prefixed) nodes — no change needed there.

- [ ] **Step 2: Regenerate the runtime bundle**

Run: `node scripts/build-runtime.mjs`
Expected: `src/runtime/runtimeSource.generated.ts` rewritten. Verify the embedded `RUNTIME_JS` still contains `SavigRuntime` and is larger than before (now includes `applyProjectFrame`/`sceneAtTime`/`computeSceneCameraTransform`).

- [ ] **Step 3: Run the full suite + typecheck + lint**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS — including `exportProject.test.ts` (asserts the export embeds `RUNTIME_JS` + contains `SavigRuntime`; the regenerated string still satisfies it). Single-scene runtime behavior is unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/index.ts src/runtime/runtimeSource.generated.ts
git commit -m "feat(8b-2c): runtime switches scenes via applyProjectFrame; regen bundle"
```

---

## Task 3: Multi-scene export e2e (runtime actually switches)

**Files:** add/extend an export e2e (Playwright) — mirror the existing `export → load headless → assert it animates` spec.

- [ ] **Step 1: Write/extend the e2e** — build a 2-scene project in the app (or via the headless `core` builders + `exportProject`), load the exported `index.html` in chromium, and assert: at a time inside scene 1's segment, scene 1's group is visible and scene 2's is `display:none`; advance to scene 2's segment, assert the visibility flips. Reuse the existing export-e2e harness (`e2e/` — find the current `*export*` spec and follow its structure for building+loading the bundle).

- [ ] **Step 2: Run** — `pnpm test:e2e <spec>` (use the repo's e2e command; check `package.json`). Expected: PASS. Kill any stale vite first (project gotcha).

- [ ] **Step 3: Commit** — `git commit -am "test(8b-2c): e2e multi-scene runtime scene-switch"`

---

## Self-Review (completed during planning)

- **Spec coverage:** 8b-2 §8 runtime scene-switching, per-scene camera query scoped to the active scene group (I2 fix), shared apply path. Bundle regen.
- **Placeholder scan:** none for Tasks 1–2 (complete code). Task 3's e2e references the repo's existing export-e2e harness rather than reproducing it — appropriate, since the harness exists and must be matched, not reinvented; the implementer reads the current export spec to mirror it.
- **Type consistency:** `applyProjectFrame(root: ParentNode, nodes: Map<string,Element>, project, time)` consumed by both `index.ts` (Task 2) and `core/render.ts` (8b-2d). The jsdom `style.display` cast mirrors the existing `applyCamera` element handling.
- **Risk:** the bundle regen is the one generated-file diff; verified by `exportProject.test.ts` and the new e2e. Single-scene parity holds because `applyProjectFrame` early-returns to the old path when `!project.scenes`.
