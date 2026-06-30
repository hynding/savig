# M5 Slice 8b-2d — Headless raster routing + describe stopgap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the headless raster path (`core/render.ts` → `renderFrameSvg`, used by PNG/thumbnail/GIF and every MCP visual response) render multi-scene projects correctly, and give `describeProject` a scene summary so the agent isn't blind to scenes.

**Architecture:** `renderFrameSvg` builds its SVG via `renderProjectDocument` (8b-2b) when `scenes` is present (else `renderSvgDocument` — parity), then applies the frame via the shared `applyProjectFrame` (8b-2c) instead of `applyFrameToNodes` + `applyCamera`. `describeProject` gains a one-line-per-scene summary when `project.scenes` is present.

**Tech Stack:** TypeScript strict, Vitest, @resvg/resvg-js + jsdom (already deps). No new deps.

## Global Constraints

- **Parity:** single-scene (`scenes` absent) `renderFrameSvg`/`describeProject` output MUST be byte-identical to today (`renderProjectDocument` delegates to `renderSvgDocument`; `applyProjectFrame` early-returns to `applyFrameToNodes` + `applyCamera`).
- **Multi-scene raster correctness:** a multi-scene project's `renderFramePng`/`renderThumbnail`/`renderGif` must show the ACTIVE scene at each master time (not a blank artboard — the bug this fixes). Verified by a headless test asserting the rendered SVG contains the active scene's node and the inactive scene hidden.
- **describe stopgap:** when `project.scenes` is present, `describeProject` lists scenes (`name`, duration, object count) and the master duration; keep it token-compact (one line per scene). Single-scene output unchanged.
- Depends on 8b-2b (`renderProjectDocument`) and 8b-2c (`applyProjectFrame`).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/core/render.ts` | `renderFrameSvg` routes through `renderProjectDocument` + `applyProjectFrame` | Modify |
| `src/core/render.test.ts` | multi-scene raster test | Modify |
| `src/core/describe.ts` | scene summary | Modify |
| `src/core/describe.test.ts` | scene-describe test | Modify |

---

## Task 1: Route `renderFrameSvg` through the multi-scene path

**Files:** Modify `src/core/render.ts`, `src/core/render.test.ts`

**Interfaces:**
- Consumes: `renderProjectDocument` (from `../services/export/...` — match the existing import path used for `renderSvgDocument`), `applyProjectFrame` (from `../runtime/frame`).
- `renderFrameSvg(project, time, opts?)` signature unchanged.

- [ ] **Step 1: Write the failing test** — append to `src/core/render.test.ts`:

Parse the rendered SVG and read each scene group's `.style.display` directly (robust to whitespace/serialization, unlike a regex on the string). `renderFrameSvg` returns SVG markup; parse it with the test's jsdom:

```ts
import { JSDOM } from 'jsdom'; // already a dep (used by core/render). Mirror core/render.test.ts's setup.

describe('renderFrameSvg — multi-scene (8b-2d)', () => {
  function multi() {
    const a = createVectorAsset('rect', { id: 'aRect' });
    const b = createVectorAsset('rect', { id: 'bRect' });
    return { ...createProject(), assets: [a, b], objects: [], scenes: [
      { id: 'scA', name: 'A', objects: [createSceneObject('aRect', { id: 'oa' })], duration: 2 },
      { id: 'scB', name: 'B', objects: [createSceneObject('bRect', { id: 'ob' })], duration: 2 },
    ] };
  }
  function sceneDisplay(svgMarkup: string, sceneId: string): string {
    const doc = new JSDOM(`<!DOCTYPE html><body>${svgMarkup}</body>`).window.document;
    const g = doc.querySelector(`[data-savig-scene="${sceneId}"]`) as HTMLElement;
    return g.style.display;
  }
  it('renders the active scene visible and the inactive scene hidden at master time t', () => {
    const project = multi();
    const at1 = renderFrameSvg(project, 1);   // scene A active
    expect(sceneDisplay(at1, 'scA')).not.toBe('none');
    expect(sceneDisplay(at1, 'scB')).toBe('none');
    const at3 = renderFrameSvg(project, 3);   // scene B active
    expect(sceneDisplay(at3, 'scB')).not.toBe('none');
    expect(sceneDisplay(at3, 'scA')).toBe('none');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm test src/core/render.test.ts` → FAIL (current `renderFrameSvg` uses `renderSvgDocument` → empty body for multi-scene; no scene groups).

- [ ] **Step 3: Implement** — in `src/core/render.ts` `renderFrameSvg`:
  - Add `renderProjectDocument` alongside the existing `renderSvgDocument` import.
  - In the `from '../runtime/frame'` import, **REPLACE** `computeFrame, applyFrameToNodes, applyCamera` with `applyProjectFrame` — all three become unused after this task (every `render.ts` export funnels through `renderFrameSvg`), so leaving them would fail `pnpm lint`. (Confirm none is referenced elsewhere in the file before removing.)
  - Replace `const markup = renderSvgDocument(project, opts);` with:
    ```ts
    const markup = project.scenes ? renderProjectDocument(project, opts) : renderSvgDocument(project, opts);
    ```
  - Replace the `applyFrameToNodes(nodes, computeFrame(project, time)); applyCamera(svg, project, time);` pair with:
    ```ts
    applyProjectFrame(svg, nodes, project, time);
    ```
  - The node-map build (`svg.querySelectorAll('[data-savig-object]')`) is unchanged — for multi-scene it now collects all scenes' prefixed nodes, which `applyProjectFrame` updates only for the active scene.

- [ ] **Step 4: Run** — `pnpm test src/core/render.test.ts && pnpm test && pnpm typecheck && pnpm lint` → PASS (single-scene render tests unchanged; `renderGif`/`renderThumbnail` ride `renderFrameSvg` so they now work for multi-scene).

- [ ] **Step 5: Commit** — `git commit -am "fix(8b-2d): renderFrameSvg routes multi-scene via renderProjectDocument + applyProjectFrame"`

---

## Task 2: `describeProject` scene summary

**Files:** Modify `src/core/describe.ts`, `src/core/describe.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/core/describe.test.ts`:

```ts
describe('describeProject — scenes (8b-2d)', () => {
  it('lists scenes with name, duration, and object count when present', () => {
    const a = createVectorAsset('rect', { id: 'aRect' });
    const project = { ...createProject(), assets: [a], objects: [], scenes: [
      { id: 'scA', name: 'Intro', objects: [createSceneObject('aRect', { id: 'oa' })], duration: 2 },
      { id: 'scB', name: 'Outro', objects: [], duration: 1 },
    ] };
    const out = describeProject(project);
    expect(out).toContain('Scenes (2)');
    expect(out).toContain('Intro');
    expect(out).toMatch(/Intro.*2/);   // duration or obj count present on the Intro line
  });
  it('single-scene project description is unchanged (no Scenes section)', () => {
    const a = createVectorAsset('rect', { id: 'r' });
    const p = { ...createProject(), assets: [a], objects: [createSceneObject('r', { id: 'o' })] };
    expect(describeProject(p)).not.toContain('Scenes (');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm test src/core/describe.test.ts` → FAIL.

- [ ] **Step 3: Implement** — in `describe.ts`, when `project.scenes` is present, prepend (or append, matching the file's section style) a compact section. Example (adapt to the file's existing formatting helpers):

```ts
if (project.scenes) {
  lines.push(`Scenes (${project.scenes.length}):`);
  for (const s of project.scenes) {
    lines.push(`  - "${s.name}" ${s.duration}s, ${s.objects.length} objs`);
  }
}
```

Keep it ONE line per scene (token-compact). The existing single-scene `Objects (...)` listing stays for `project.objects` (empty in multi-scene → harmless `Objects (0)`), or gate it behind `!project.scenes` if the file's style prefers — match what reads cleanly and keeps single-scene output byte-identical.

- [ ] **Step 4: Run** — `pnpm test src/core/describe.test.ts && pnpm test && pnpm typecheck && pnpm lint` → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(8b-2d): describeProject scene summary (agent stopgap)"`

---

## Self-Review (completed during planning)

- **Spec coverage:** 8b-2 §7 C4 (headless raster routed through `renderProjectDocument`) + I5 (describe scene-count stopgap). Single-scene parity by delegation/early-return.
- **Placeholder scan:** none — complete code; the two adaptation notes (display-assertion robustness, describe section placement) are bounded to matching the file's existing style, not deferred logic.
- **Type consistency:** `renderProjectDocument`/`applyProjectFrame` signatures match their definitions (8b-2b/2c). After this slice, `renderGif`/`renderFramePng`/`renderThumbnail`/`renderFrames` (all riding `renderFrameSvg`) and every MCP visual response work for multi-scene.
- **Completes 8b-2:** export (2a/2b), runtime (2c), and headless raster + describe (2d) are all multi-scene-aware; the only consumer still scene-unaware is the editor (8b-3) and the DSL/MCP authoring tools (8b-5).
