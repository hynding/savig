# M5 Slice 8b-2b — `renderProjectDocument` (multi-scene export) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add `renderProjectDocument(project)` that emits a single self-contained SVG containing every scene — each wrapped in `<g data-savig-scene="id">` (only the first visible), with scene-prefixed per-scene defs, globally-deduped asset defs, and a per-scene camera wrap.

**Architecture:** Build on 8b-2a's `renderSceneBody(sceneView, sceneId)`. For each scene, render a scene-scoped `Project` view (`{ ...project, objects: scene.objects, camera: scene.camera, scenes: undefined }`), collect its `localDefs` (already scene-prefixed) and `assetDefs` (deduped into one global map by assetId), wrap its body in a per-scene `<g data-savig-camera>` (via new `computeSceneCameraTransform`) then `<g data-savig-scene>`. Single-scene (`scenes` absent) delegates to `renderSvgDocument` → byte-identical parity.

**Tech Stack:** TypeScript strict, Vitest. No deps. No runtime change yet (8b-2c).

## Global Constraints

- **Parity:** `renderProjectDocument(project)` for a project with NO `scenes` MUST equal `renderSvgDocument(project)` exactly (it delegates).
- **Global asset-def dedup:** an `SvgAsset` (`savig-asset-*`) or any asset-keyed def used in multiple scenes appears ONCE in the shared `<defs>` (keyed by assetId). Scene-prefixed per-scene defs (gradient/clip/tint) are concatenated per scene (they cannot collide — they carry the `${sceneId}:` prefix from 8b-2a).
- **Scene group:** `<g data-savig-scene="${scene.id}">`; the FIRST scene visible, the rest `style="display:none"`. The per-scene camera wrap (`<g data-savig-camera transform=…>`) goes INSIDE the scene group.
- **Per-scene camera:** `computeSceneCameraTransform(camera: Camera | undefined, width, height, time)` returns `null` when `camera` is absent (no wrapper). The single-scene `computeCameraTransform(project, time)` is unchanged.
- Depends on 8b-2a (`renderSceneBody`) and 8b-1a (`projectScenes`).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/engine/camera.ts` | `computeSceneCameraTransform(camera, w, h, t)` | Modify |
| `src/engine/camera.test.ts` | unit tests for the scene-camera transform | Modify |
| `src/services/export/renderDocument.ts` | `renderProjectDocument` | Modify |
| `src/services/export/renderDocument.test.ts` | multi-scene export tests | Modify |

---

## Task 1: `computeSceneCameraTransform`

**Files:** Modify `src/engine/camera.ts`, `src/engine/camera.test.ts`

**Interfaces:**
- Produces: `export function computeSceneCameraTransform(camera: Camera | undefined, width: number, height: number, time: number): string | null` — `null` when `camera` is absent; else `cameraTransform(sampleCamera(camera, time), width, height)`.

- [ ] **Step 1: Write the failing test** — append to `camera.test.ts`:

```ts
describe('computeSceneCameraTransform (8b-2b)', () => {
  it('returns null when camera is undefined', () => {
    expect(computeSceneCameraTransform(undefined, 1280, 720, 0)).toBeNull();
  });
  it('matches computeCameraTransform for the same camera', () => {
    const camera = { base: { x: 100, y: 50, zoom: 2, rotation: 10 }, tracks: {} };
    const viaScene = computeSceneCameraTransform(camera, 1280, 720, 0);
    const viaProject = computeCameraTransform({ ...createProject({ width: 1280, height: 720 }), camera }, 0);
    expect(viaScene).toBe(viaProject);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm test src/engine/camera.test.ts` → FAIL (not exported).

- [ ] **Step 3: Implement** — in `camera.ts`, add (reuse the existing `cameraTransform` + `sampleCamera` helpers that `computeCameraTransform` uses):

```ts
/** Camera view transform for an EXPLICIT camera (per-scene, 8b) at `time`, or null when absent.
 *  Same math as computeCameraTransform but the camera + artboard dims are passed in rather than
 *  read off the project, so each scene can supply its own. */
export function computeSceneCameraTransform(
  camera: Camera | undefined, width: number, height: number, time: number,
): string | null {
  if (!camera) return null;
  return cameraTransform(sampleCamera(camera, time), width, height);
}
```

Then refactor `computeCameraTransform` to delegate (keeps one source of truth, parity-safe):

```ts
export function computeCameraTransform(project: Project, time: number): string | null {
  return computeSceneCameraTransform(project.camera, project.meta.width, project.meta.height, time);
}
```

- [ ] **Step 4: Run** — `pnpm test src/engine/camera.test.ts && pnpm typecheck` → PASS (existing camera tests still green — `computeCameraTransform` behavior unchanged).

- [ ] **Step 5: Commit** — `git commit -am "feat(8b-2b): computeSceneCameraTransform (per-scene camera)"`

---

## Task 2: `renderProjectDocument`

**Files:** Modify `src/services/export/renderDocument.ts`, `src/services/export/renderDocument.test.ts`

**Interfaces:**
- Consumes: `renderSceneBody` (8b-2a), `projectScenes` + `computeSceneCameraTransform`.
- Produces: `export function renderProjectDocument(project: Project, opts?: { viewBox?: string }): string`.

- [ ] **Step 1: Write the failing tests** — append to `renderDocument.test.ts`:

```ts
describe('renderProjectDocument — multi-scene (8b-2b)', () => {
  function twoSceneProject() {
    const a = createVectorAsset('rect', { id: 'aRect' });
    const b = createVectorAsset('rect', { id: 'bRect' });
    return {
      ...createProject(),
      assets: [a, b],
      objects: [],
      scenes: [
        { id: 'scA', name: 'A', objects: [createSceneObject('aRect', { id: 'oa' })], duration: 2 },
        { id: 'scB', name: 'B', objects: [createSceneObject('bRect', { id: 'ob' })], duration: 2 },
      ],
    };
  }

  it('single-scene project delegates to renderSvgDocument (byte-identical)', () => {
    const asset = createVectorAsset('rect', { id: 'r' });
    const p = { ...createProject(), assets: [asset], objects: [createSceneObject('r', { id: 'o' })] };
    expect(renderProjectDocument(p)).toBe(renderSvgDocument(p));
  });

  it('emits one <g data-savig-scene> per scene; first visible, rest hidden', () => {
    const out = renderProjectDocument(twoSceneProject());
    expect(out).toContain('<g data-savig-scene="scA"');
    expect(out).toContain('<g data-savig-scene="scB"');
    expect(out).toMatch(/data-savig-scene="scB"[^>]*style="display:none"/);
    expect(out).not.toMatch(/data-savig-scene="scA"[^>]*display:none/); // first scene visible
    expect(out).toContain('data-savig-object="scA:oa"');
    expect(out).toContain('data-savig-object="scB:ob"');
  });

  it('dedups a shared svg-asset def across scenes (one savig-asset def)', () => {
    const svgAsset = { id: 'svg1', kind: 'svg' as const, name: 's', normalizedContent: '<rect/>', viewBox: '0 0 1 1', width: 1, height: 1 };
    const project = {
      ...createProject(), assets: [svgAsset], objects: [],
      scenes: [
        { id: 'scA', name: 'A', objects: [createSceneObject('svg1', { id: 'oa' })], duration: 1 },
        { id: 'scB', name: 'B', objects: [createSceneObject('svg1', { id: 'ob' })], duration: 1 },
      ],
    };
    const out = renderProjectDocument(project);
    const defCount = (out.match(/id="savig-asset-svg1"/g) ?? []).length;
    expect(defCount).toBe(1); // global dedup by assetId
  });

  it('wraps each scene body in its own data-savig-camera when the scene has a camera', () => {
    const p = twoSceneProject();
    p.scenes[0].camera = { base: { x: 0, y: 0, zoom: 2, rotation: 0 }, tracks: {} };
    const out = renderProjectDocument(p);
    // scene A has a camera wrapper; scene B (no camera) does not
    expect(out).toMatch(/data-savig-scene="scA"[^>]*>\s*<g data-savig-camera/);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm test src/services/export/renderDocument.test.ts` → FAIL (`renderProjectDocument` not exported).

- [ ] **Step 3: Implement `renderProjectDocument`** (add `projectScenes` and `computeSceneCameraTransform` to the existing `from '../../engine'` import in `renderDocument.ts` — both are barrel-exported via `export * from './scenes'` / `export * from './camera'`):

```ts
/** Render a (possibly multi-scene) project to one self-contained SVG. Single-scene (no `scenes`)
 *  delegates to renderSvgDocument (byte-identical). Multi-scene: each scene becomes a
 *  <g data-savig-scene> (first visible, rest display:none), with scene-prefixed per-scene defs,
 *  globally-deduped asset defs, and a per-scene camera wrap. */
export function renderProjectDocument(project: Project, opts?: { viewBox?: string }): string {
  if (!project.scenes) return renderSvgDocument(project, opts);

  const assetDefsAll = new Map<string, string>(); // dedup by assetId across all scenes
  const localDefsParts: string[] = [];
  const sceneGroups: string[] = [];

  projectScenes(project).forEach((scene, i) => {
    const sceneView: Project = { ...project, objects: scene.objects, camera: scene.camera, scenes: undefined };
    const { body, assetDefs, localDefs } = renderSceneBody(sceneView, scene.id);
    for (const [id, def] of assetDefs) assetDefsAll.set(id, def);
    localDefsParts.push(localDefs);
    const cam = computeSceneCameraTransform(scene.camera, project.meta.width, project.meta.height, 0);
    const inner = cam !== null ? `<g data-savig-camera transform="${cam}">${body}</g>` : body;
    const hidden = i === 0 ? '' : ' style="display:none"';
    sceneGroups.push(`<g data-savig-scene="${scene.id}"${hidden}>${inner}</g>`);
  });

  const defs = Array.from(assetDefsAll.values()).join('') + localDefsParts.join('');
  const viewBox = opts?.viewBox ?? `0 0 ${fmt(project.meta.width)} ${fmt(project.meta.height)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><defs>${defs}</defs>${sceneGroups.join('')}</svg>`;
}
```

- [ ] **Step 4: Run tests** — `pnpm test src/services/export/renderDocument.test.ts && pnpm test && pnpm typecheck && pnpm lint` → PASS (all goldens + new multi-scene tests).

- [ ] **Step 5: Commit** — `git commit -am "feat(8b-2b): renderProjectDocument (multi-scene SVG, scene groups, asset dedup)"`

---

## Self-Review (completed during planning)

- **Spec coverage:** 8b-2 §7 export model (Model X — inline all scenes, switch by visibility), per-scene camera, global asset-def dedup, scene-prefixed per-scene defs. Single-scene parity via delegation.
- **Placeholder scan:** none — complete code in each step.
- **Type consistency:** consumes `renderSceneBody`'s `{ body, assetDefs, localDefs }` (8b-2a) and `computeSceneCameraTransform` (Task 1); `sceneView` matches `Project` (objects/camera swapped, `scenes: undefined`).
- **Deferred to 8b-2c/2d:** the runtime does not yet switch scenes (8b-2c regenerates the bundle); `core/render.ts` raster still uses `renderSvgDocument` (8b-2d routes it). So a multi-scene EXPORT renders all scene groups but the runtime won't toggle them until 8b-2c — acceptable mid-decomposition (multi-scene is not user-reachable until 8b-3).
