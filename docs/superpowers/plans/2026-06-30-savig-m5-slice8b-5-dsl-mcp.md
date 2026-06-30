# M5 Slice 8b-5 — Multi-scene DSL + MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multi-scene projects authorable and driveable headlessly — pure `core` scene builders, `ShortDoc.scenes` DSL compile/decompile, and MCP scene tools — so an agent can build and edit a multi-shot short, with object edits routed to the session's current scene. Single-scene projects stay byte-identical.

**Architecture:** Reuse the engine scene primitives (`promoteToMultiScene`/`demoteToSingleScene`/`projectScenes`/`resolveTimeline` in `src/engine/scenes.ts`). Add pure id-addressed scene builders + one `withScene(project, sceneId, fn)` routing helper in a new `src/core/scenes.ts`. The existing pure object builders (`addRect`/`setKeyframe`/…) are UNCHANGED; MCP wraps them in `withScene` so they target `session.currentSceneId`. DSL gains `ShortScene`/`ShortDoc.scenes` via a refactor of the compile/decompile loops into per-scene helpers.

**Tech Stack:** TypeScript (strict), Vitest, pnpm. No DOM/Zustand in `core`/`mcp` (headless).

## Global Constraints

- **Absent = byte-identical parity.** A single-scene `Project`/`ShortDoc` (no `scenes`) compiles, decompiles, describes, renders, and round-trips exactly as before. The full prior suite must stay green. Baseline before this slice: **1670 unit** tests green on `main` (after 8b-3).
- **Source-of-truth rule:** when `scenes` is present, `project.objects` is `[]` and `project.camera` undefined; scenes authoritative. Promotion/demotion via the engine helpers. `validateProject` already enforces this (no change needed).
- **Builders FAIL LOUD on bad references** (a programmatic/agent caller wants an error, not a silent no-op) — matches `requireObject` in `build.ts`. Unknown `sceneId` throws.
- **DSL `objects` and `scenes` are mutually exclusive** — both present ⇒ `compileShort` throws.
- **`ROOT_SCENE_ID = 'scene-root'`**; `Scene`/`Transition`/`Camera` types live in `src/engine/types.ts`. All scenes share the project artboard (`Scene` has no width/height).
- **`MIN_SCENE_DURATION` floor for `setSceneDuration`** = `1/240` (same as the editor's `scenesSlice.ts`).
- Run `pnpm test`, `pnpm typecheck`, `pnpm lint`. Commit after each task. Each task is its own reviewable unit; no merge to `main` until its review is clean.
- **NOT in scope (per spec §12 + §9):** transition RENDERING (8b-4) — `setSceneTransition` only writes the `transitionIn` data. No `rename_scene` tool (spec's tool set omits it; scene names come from `addScene` opts / `ShortScene.name`). The editor's `scenesSlice.ts` is a separate Zustand layer — do NOT touch it.

---

## File Structure

- `src/core/scenes.ts` — **new.** Pure scene builders (`addScene`/`removeScene`/`reorderScene`/`setSceneDuration`/`setSceneTransition`) + `withScene(project, sceneId, fn)` routing helper. Reuses `promoteToMultiScene`/`demoteToSingleScene` from `../engine`.
- `src/core/index.ts` — export the new scene builders + `withScene`.
- `src/core/dsl.ts` — refactor compile/decompile into per-scene helpers; add `ShortScene` + `ShortDoc.scenes?`; multi-scene compile/decompile; mutual-exclusivity.
- `src/mcp/tools.ts` — `Session.currentSceneId`; route object/camera tools via `withScene`; `edited()` renders the current scene; 7 new scene tools.
- Tests: `src/core/scenes.test.ts` (new), `src/core/dsl.test.ts` (extend), `src/mcp/tools.test.ts` (extend).

---

## Task 1: Core scene builders + `withScene` routing helper

**Files:**
- Create: `src/core/scenes.ts`
- Modify: `src/core/index.ts` (exports)
- Test: `src/core/scenes.test.ts`

**Interfaces:**
- Consumes: `promoteToMultiScene`, `demoteToSingleScene`, `newId` from `../engine`; types `Project`, `Scene`, `Transition`, `Camera`.
- Produces:
  - `addScene(project, opts?: { name?: string; duration?: number; afterIndex?: number }) → { project: Project; sceneId: string }` — auto-promotes a single-scene project; inserts a new empty scene after `afterIndex` (clamped to `[0, len-1]`; default = end); `duration` default `1`; `name` default `Scene ${n}`.
  - `removeScene(project, sceneId: string) → Project` — throws if `sceneId` unknown or project single-scene; refuses (throws) to remove the last scene; demotes to single-scene when exactly one remains (`demoteToSingleScene`).
  - `reorderScene(project, sceneId: string, toIndex: number) → Project` — throws if unknown/single-scene; moves the scene to `toIndex` (clamped).
  - `setSceneDuration(project, sceneId: string, duration: number) → Project` — throws if unknown/single-scene; clamps to `>= 1/240`.
  - `setSceneTransition(project, sceneId: string, transition: Transition) → Project` — throws if unknown/single-scene; sets `scene.transitionIn` (data only; rendering is 8b-4).
  - `withScene<T extends { project: Project }>(project, sceneId: string | undefined, fn: (p: Project) => T) → T` — applies `fn` within a scene-view and merges objects+camera back (assets global). When `sceneId` is undefined or project single-scene, applies `fn` to `project` directly (parity).

- [ ] **Step 1: Write the failing tests.** In `src/core/scenes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createProject, createSceneObject } from '../engine';
import { addScene, removeScene, reorderScene, setSceneDuration, setSceneTransition, withScene, addRect } from '.';

const single = () => ({ ...createProject(), objects: [createSceneObject('a', { id: 'o1' })] });

describe('core/scenes builders', () => {
  it('addScene promotes a single-scene project and returns the new scene id', () => {
    const { project, sceneId } = addScene(single());
    expect(project.scenes).toBeDefined();
    expect(project.scenes!.length).toBe(2);     // promoted root scene + new
    expect(project.objects).toEqual([]);         // source-of-truth
    expect(project.scenes!.some((s) => s.id === sceneId)).toBe(true);
    expect(project.scenes!.find((s) => s.id === sceneId)!.objects).toEqual([]);
  });

  it('addScene inserts after afterIndex (clamped) with default duration 1', () => {
    const a = addScene(single());               // [root, new1]
    const b = addScene(a.project, { afterIndex: 0, name: 'Mid', duration: 2.5 });
    const ids = b.project.scenes!.map((s) => s.id);
    expect(ids[1]).toBe(b.sceneId);              // inserted at index 1 (after 0)
    const sc = b.project.scenes!.find((s) => s.id === b.sceneId)!;
    expect(sc).toMatchObject({ name: 'Mid', duration: 2.5 });
  });

  it('removeScene drops a scene; demotes to single-scene when one remains', () => {
    const { project } = addScene(single());      // 2 scenes
    const root = project.scenes![0].id;
    const other = project.scenes![1].id;
    const afterFirst = removeScene(project, other);
    expect(afterFirst.scenes).toBeUndefined();   // demoted
    expect(() => removeScene(afterFirst, root)).toThrow(); // single-scene now → throws
  });

  it('removeScene/reorderScene/setSceneDuration/setSceneTransition throw on unknown id', () => {
    const { project } = addScene(single());
    expect(() => removeScene(project, 'nope')).toThrow();
    expect(() => reorderScene(project, 'nope', 0)).toThrow();
    expect(() => setSceneDuration(project, 'nope', 1)).toThrow();
    expect(() => setSceneTransition(project, 'nope', { kind: 'cut' })).toThrow();
  });

  it('reorderScene moves a scene; setSceneDuration clamps to > 0; setSceneTransition writes transitionIn', () => {
    const { project } = addScene(single());
    const [a, b] = project.scenes!.map((s) => s.id);
    expect(reorderScene(project, b, 0).scenes!.map((s) => s.id)).toEqual([b, a]);
    expect(setSceneDuration(project, b, 0).scenes!.find((s) => s.id === b)!.duration).toBeGreaterThan(0);
    expect(setSceneTransition(project, b, { kind: 'crossfade', duration: 0.5 }).scenes!.find((s) => s.id === b)!.transitionIn)
      .toEqual({ kind: 'crossfade', duration: 0.5 });
  });

  it('withScene routes a builder into the target scene (objects scene-local, assets global)', () => {
    const { project, sceneId } = addScene(single());     // scene[1] is empty & selected target
    const r = withScene(project, sceneId, (p) => addRect(p, { x: 0, y: 0, width: 10, height: 10, id: 'r1' }));
    expect(r.project.objects).toEqual([]);                // root stays empty
    expect(r.project.scenes!.find((s) => s.id === sceneId)!.objects.map((o) => o.id)).toEqual(['r1']);
    expect(r.project.assets.some((a) => a.id === 'r1-asset')).toBe(true); // asset global
    expect(r.id).toBe('r1');                              // pass-through of {project, id}
  });

  it('withScene with undefined sceneId / single-scene applies directly (parity)', () => {
    const p = single();
    const r = withScene(p, undefined, (x) => addRect(x, { x: 0, y: 0, width: 5, height: 5, id: 'r2' }));
    expect(r.project.objects.map((o) => o.id)).toContain('r2');
    expect(r.project.scenes).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, verify fail.** Run: `pnpm test core/scenes` — Expected: FAIL (module/exports missing).

- [ ] **Step 3: Implement `src/core/scenes.ts`.**

```ts
/** Headless, id-addressed scene-sequencing builders over a `Project` (the multi-scene analog of
 *  build.ts). Pure `Project → Project` (or `{ project, sceneId }`); FAIL LOUD on bad references.
 *  Reuses the engine promote/demote so the absent-scenes parity discipline is preserved. */
import { promoteToMultiScene, demoteToSingleScene, newId } from '../engine';
import type { Project, Scene, Transition } from '../engine';

const MIN_SCENE_DURATION = 1 / 240;

function requireScene(project: Project, sceneId: string): Scene {
  const s = project.scenes?.find((x) => x.id === sceneId);
  if (!s) throw new Error(`savig/core: no scene with id "${sceneId}"`);
  return s;
}

/** Add a new empty scene. Auto-promotes a single-scene project so scene 0 holds the old root.
 *  Inserts after `afterIndex` (clamped; default = end). */
export function addScene(
  project: Project,
  opts: { name?: string; duration?: number; afterIndex?: number } = {},
): { project: Project; sceneId: string } {
  const promoted = project.scenes ? project : promoteToMultiScene(project);
  const scenes = promoted.scenes!;
  const scene: Scene = {
    id: newId(),
    name: opts.name ?? `Scene ${scenes.length + 1}`,
    objects: [],
    duration: opts.duration ?? 1,
  };
  const at = opts.afterIndex === undefined ? scenes.length - 1 : Math.max(0, Math.min(opts.afterIndex, scenes.length - 1));
  const next = [...scenes.slice(0, at + 1), scene, ...scenes.slice(at + 1)];
  return { project: { ...promoted, objects: [], camera: undefined, scenes: next }, sceneId: scene.id };
}

/** Remove a scene. Throws if single-scene or id unknown or it is the last scene. Demotes back to a
 *  single-scene project (parity form) when exactly one scene remains. */
export function removeScene(project: Project, sceneId: string): Project {
  if (!project.scenes) throw new Error('savig/core: removeScene on a single-scene project');
  requireScene(project, sceneId);
  if (project.scenes.length <= 1) throw new Error('savig/core: cannot remove the last scene');
  const next = project.scenes.filter((s) => s.id !== sceneId);
  return next.length === 1 ? demoteToSingleScene({ ...project, scenes: next }) : { ...project, scenes: next };
}

export function reorderScene(project: Project, sceneId: string, toIndex: number): Project {
  if (!project.scenes) throw new Error('savig/core: reorderScene on a single-scene project');
  const from = project.scenes.findIndex((s) => s.id === sceneId);
  if (from < 0) throw new Error(`savig/core: no scene with id "${sceneId}"`);
  const clamped = Math.max(0, Math.min(toIndex, project.scenes.length - 1));
  const next = [...project.scenes];
  const [moved] = next.splice(from, 1);
  next.splice(clamped, 0, moved);
  return { ...project, scenes: next };
}

export function setSceneDuration(project: Project, sceneId: string, duration: number): Project {
  if (!project.scenes) throw new Error('savig/core: setSceneDuration on a single-scene project');
  requireScene(project, sceneId);
  const d = Math.max(MIN_SCENE_DURATION, duration);
  return { ...project, scenes: project.scenes.map((s) => (s.id === sceneId ? { ...s, duration: d } : s)) };
}

/** Set the transition INTO a scene (data only; crossfade/dip RENDERING lands in 8b-4). */
export function setSceneTransition(project: Project, sceneId: string, transition: Transition): Project {
  if (!project.scenes) throw new Error('savig/core: setSceneTransition on a single-scene project');
  requireScene(project, sceneId);
  return { ...project, scenes: project.scenes.map((s) => (s.id === sceneId ? { ...s, transitionIn: transition } : s)) };
}

/** Apply a project transform WITHIN one scene: run `fn` on a scene-view (objects + camera swapped,
 *  scenes stripped), then merge the resulting objects + camera back into that scene; assets are
 *  global so they carry straight through. When `sceneId` is undefined or the project is single-scene,
 *  `fn` runs on the project directly (byte-identical parity). The single seam that lets the unchanged
 *  object/camera builders target the current scene. */
export function withScene<T extends { project: Project }>(
  project: Project,
  sceneId: string | undefined,
  fn: (p: Project) => T,
): T {
  if (!project.scenes || !sceneId) return fn(project);
  const scene = requireScene(project, sceneId);
  const view: Project = { ...project, objects: scene.objects, camera: scene.camera, scenes: undefined };
  const r = fn(view);
  const merged: Project = {
    ...project,
    assets: r.project.assets,
    scenes: project.scenes.map((s) => (s.id === sceneId ? { ...s, objects: r.project.objects, camera: r.project.camera } : s)),
  };
  return { ...r, project: merged };
}
```

- [ ] **Step 4: Export from `src/core/index.ts`.** Add `export { addScene, removeScene, reorderScene, setSceneDuration, setSceneTransition, withScene } from './scenes';` (match the existing export style in that file). Confirm `Transition` is exported from `../engine` (it is, per types.ts) — re-export from core if other core files need it.

- [ ] **Step 5: Run, verify pass + parity.** Run: `pnpm test core/scenes && pnpm test core` — Expected: PASS. Run `pnpm test` — Expected: 1670 still green (the new module is purely additive; nothing else imports it yet).

- [ ] **Step 6: Typecheck + commit.**

```bash
pnpm typecheck && pnpm lint
git add src/core/scenes.ts src/core/scenes.test.ts src/core/index.ts
git commit -m "feat(8b-5): core scene builders (add/remove/reorder/setDuration/setTransition) + withScene helper"
```

---

## Task 2: DSL — `ShortDoc.scenes` compile/decompile

**Files:**
- Modify: `src/core/dsl.ts`
- Test: `src/core/dsl.test.ts`

**Interfaces:**
- Consumes: existing object builders, `setCamera`/`setCameraKeyframe`, `createProject`, `newId`; `Transition`/`Camera` types.
- Produces:
  - `interface ShortScene { name?: string; duration: number; objects: ShortObject[]; camera?: ShortCamera; transitionIn?: Transition }`
  - `ShortDoc.objects?` becomes optional; `ShortDoc.scenes?: ShortScene[]` added.
  - `compileShort` handles `scenes` (mutually exclusive with `objects`, fail-loud); `decompileProject` emits `scenes` for a multi-scene project.

- [ ] **Step 1: Write the failing tests.** In `src/core/dsl.test.ts` add:

```ts
import { describe, it, expect } from 'vitest';
import { compileShort, decompileProject } from '.';
import type { ShortDoc } from '.';

const sceneDoc: ShortDoc = {
  meta: { name: 'Multi', width: 100, height: 100, fps: 30 },
  scenes: [
    { name: 'A', duration: 2, objects: [{ type: 'rect', x: 0, y: 0, width: 10, height: 10, id: 'a1' }] },
    { name: 'B', duration: 1.5, transitionIn: { kind: 'crossfade', duration: 0.5 },
      objects: [{ type: 'ellipse', x: 5, y: 5, width: 20, height: 20, id: 'b1' }] },
  ],
};

describe('core/dsl multi-scene', () => {
  it('compileShort builds Project.scenes and leaves objects empty', () => {
    const p = compileShort(sceneDoc);
    expect(p.objects).toEqual([]);
    expect(p.scenes!.map((s) => s.name)).toEqual(['A', 'B']);
    expect(p.scenes![0].duration).toBe(2);
    expect(p.scenes![1].transitionIn).toEqual({ kind: 'crossfade', duration: 0.5 });
    expect(p.scenes![0].objects.map((o) => o.id)).toEqual(['a1']);
    expect(p.assets.some((a) => a.id === 'a1-asset')).toBe(true); // assets global across scenes
    expect(p.assets.some((a) => a.id === 'b1-asset')).toBe(true);
  });

  it('compileShort fails loud when objects and scenes are both present', () => {
    expect(() => compileShort({ objects: [{ type: 'rect', x: 0, y: 0, width: 1, height: 1 }], scenes: [] } as ShortDoc))
      .toThrow();
  });

  it('decompileProject emits scenes; round-trips stably', () => {
    const p1 = compileShort(sceneDoc);
    const doc = decompileProject(p1);
    expect(doc.scenes).toBeDefined();
    expect(doc.objects).toBeUndefined();
    const p2 = compileShort(doc);
    expect(p2.scenes!.map((s) => ({ name: s.name, duration: s.duration }))).toEqual(p1.scenes!.map((s) => ({ name: s.name, duration: s.duration })));
    for (let i = 0; i < p1.scenes!.length; i++) {
      expect(p2.scenes![i].objects.map((o) => ({ base: o.base, shapeBase: o.shapeBase }))).toEqual(
        p1.scenes![i].objects.map((o) => ({ base: o.base, shapeBase: o.shapeBase })),
      );
      expect(p2.scenes![i].transitionIn).toEqual(p1.scenes![i].transitionIn);
    }
  });

  it('single-scene doc still compiles/decompiles unchanged (parity)', () => {
    const doc: ShortDoc = { meta: { name: 'S' }, objects: [{ type: 'rect', x: 1, y: 2, width: 3, height: 4, id: 'r' }] };
    const round = decompileProject(compileShort(doc));
    expect(round.scenes).toBeUndefined();
    expect(round.objects!.map((o) => o.id)).toEqual(['r']);
  });
});
```

- [ ] **Step 2: Run, verify fail.** Run: `pnpm test core/dsl` — Expected: FAIL (`scenes` not handled; `decompileProject` has no `scenes`).

- [ ] **Step 3: Refactor compile into a reusable per-scene helper, then add the scenes branch.** In `dsl.ts`:
  - Extract the object-compile loop (current lines 79–105) into `function compileObjectsInto(project: Project, objects: ShortObject[]): Project { … returns project … }` and the camera block (106–115) into `function compileCameraInto(project: Project, camera: ShortCamera): Project { … }`.
  - Make `ShortDoc.objects?: ShortObject[]` optional; add `scenes?: ShortScene[]`. Add the `ShortScene` interface (import `Transition` from `../engine`).
  - Rewrite `compileShort`:

```ts
export function compileShort(doc: ShortDoc): Project {
  if (!doc) throw new Error('compileShort: missing doc');
  if (doc.scenes && doc.objects && doc.objects.length) {
    throw new Error('compileShort: doc.objects and doc.scenes are mutually exclusive');
  }
  if (doc.scenes) {
    let project = createProject(doc.meta ?? {});           // objects:[], scenes undefined
    const scenes: Scene[] = [];
    for (const sc of doc.scenes) {
      if (!Array.isArray(sc.objects)) throw new Error('compileShort: each scene needs an objects array');
      if (typeof sc.duration !== 'number') throw new Error('compileShort: each scene needs a numeric duration');
      let view: Project = { ...project, objects: [], camera: undefined };  // carry accumulated global assets
      view = compileObjectsInto(view, sc.objects);
      if (sc.camera) view = compileCameraInto(view, sc.camera);
      scenes.push({
        id: newId(),
        name: sc.name ?? `Scene ${scenes.length + 1}`,
        objects: view.objects,
        duration: sc.duration,
        ...(view.camera ? { camera: view.camera } : {}),
        ...(sc.transitionIn ? { transitionIn: sc.transitionIn } : {}),
      });
      project = { ...project, assets: view.assets };          // accumulate global assets
    }
    return { ...project, objects: [], camera: undefined, scenes };
  }
  if (!Array.isArray(doc.objects)) throw new Error('compileShort: doc.objects must be an array');
  let project = compileObjectsInto(createProject(doc.meta ?? {}), doc.objects);
  if (doc.camera) project = compileCameraInto(project, doc.camera);
  return project;
}
```

  (import `Scene` from `../engine`.)

- [ ] **Step 4: Refactor decompile into a per-scene helper, then add the scenes branch.** Extract the object-extraction loop (current lines 125–176) into `function decompileObjects(project: Project): ShortObject[]` (it reads `project.objects`/`project.assets`) and the camera block (181–188) into `function decompileCamera(camera: Camera): ShortCamera`. Then:

```ts
export function decompileProject(project: Project): ShortDoc {
  const meta = { name: project.meta.name, width: project.meta.width, height: project.meta.height, fps: project.meta.fps, loop: project.meta.loop, duration: project.meta.duration, durationMode: project.meta.durationMode };
  if (project.scenes) {
    const scenes: ShortScene[] = project.scenes.map((s) => ({
      ...(s.name ? { name: s.name } : {}),
      duration: s.duration,
      objects: decompileObjects({ ...project, objects: s.objects, camera: s.camera, scenes: undefined }),
      ...(s.camera ? { camera: decompileCamera(s.camera) } : {}),
      ...(s.transitionIn && s.transitionIn.kind !== 'cut' ? { transitionIn: s.transitionIn } : {}),
    }));
    return { meta, scenes };
  }
  const doc: ShortDoc = { meta, objects: decompileObjects(project) };
  if (project.camera) doc.camera = decompileCamera(project.camera);
  return doc;
}
```

  Note: `decompileObjects` extracts assets from the project it is given — pass a scene-view (`objects: s.objects`) and the global `assets` stay on the view, so per-scene object/asset resolution works.

- [ ] **Step 5: Run, verify pass + parity.** Run: `pnpm test core/dsl` — Expected: PASS (incl. the single-scene parity test). Run `pnpm test` — Expected: 1670 + new green (the existing single-scene DSL tests prove the refactor preserved behavior).

- [ ] **Step 6: Typecheck + commit.**

```bash
pnpm typecheck && pnpm lint
git add src/core/dsl.ts src/core/dsl.test.ts
git commit -m "feat(8b-5): ShortDoc.scenes compile/decompile (per-scene helpers, mutual exclusivity)"
```

---

## Task 3: MCP — `Session.currentSceneId` + route object/camera tools + scene-aware thumbnail

**Files:**
- Modify: `src/mcp/tools.ts`
- Test: `src/mcp/tools.test.ts`

**Interfaces:**
- Consumes: `withScene` (Task 1), `resolveTimeline` (engine).
- Produces: `Session` gains `currentSceneId?: string`. `edited()` renders the current scene's frame. Object/camera tools (`add_rect`/`add_ellipse`/`add_text`/`set_keyframe`/`move_to`/`fade`/`set_camera`/`camera_move`, and any `add_path` if present) route through `withScene(session.project, session.currentSceneId, …)`.

- [ ] **Step 1: Write the failing tests.** In `src/mcp/tools.test.ts`:

```ts
it('object tools write into the current scene when multi-scene', () => {
  const s = freshSession();
  tool('add_scene').run(s, {});                         // promote + select new scene (Task 4 — see note)
  // If add_scene is not yet available in this task, set up via load_dsl of a 2-scene doc and select_scene.
  const sceneId = s.currentSceneId!;
  tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r1' });
  expect(s.project.objects).toEqual([]);                // root stays empty
  expect(s.project.scenes!.find((sc) => sc.id === sceneId)!.objects.map((o) => o.id)).toEqual(['r1']);
});

it('single-scene object tools unchanged (parity)', () => {
  const s = freshSession();
  tool('add_rect').run(s, { x: 0, y: 0, width: 10, height: 10, id: 'r1' });
  expect(s.project.objects.map((o) => o.id)).toEqual(['r1']);
  expect(s.project.scenes).toBeUndefined();
});
```

NOTE: this task's tests depend on a way to enter multi-scene mode. If you implement Task 3 before Task 4, drive multi-scene via `load_dsl` with a 2-scene `ShortDoc` (Task 2) and set `currentSceneId` in `load_dsl`. The plan's recommended order is 1→2→3→4, so `load_dsl` is available; use it in the Task-3 test instead of `add_scene`.

- [ ] **Step 2: Run, verify fail.** Run: `pnpm test mcp` — Expected: FAIL (object tools write root; `currentSceneId` absent).

- [ ] **Step 3: Add `currentSceneId` + a scene-default helper + scene-aware `edited()`.**

```ts
import { renderThumbnail, /* … */ withScene } from '../core';
import { resolveTimeline } from '../engine';

export interface Session {
  project: Project;
  currentSceneId?: string;
}

// The master-timeline time at which the current scene starts (0 single-scene), so the thumbnail
// shows the scene the agent is editing.
function currentSceneTime(session: Session): number {
  if (!session.project.scenes || !session.currentSceneId) return 0;
  const span = resolveTimeline(session.project).find((sp) => sp.scene.id === session.currentSceneId);
  return span ? span.start : 0;
}

function edited(session: Session, status: string): ToolResult {
  return {
    content: [
      text(`${status}\n\n${describeProject(session.project)}`),
      pngImage(renderThumbnail(session.project, { time: currentSceneTime(session) })),
    ],
  };
}
```

  (Confirm `renderThumbnail`'s signature accepts `{ time }` — per `core/render.ts` it takes `opts?: { time?; width?; background? }`. If `renderThumbnail` does not forward `time`, add the pass-through in `core/render.ts` and note it; the explorer reported it accepts `time`.)

- [ ] **Step 4: Set `currentSceneId` wherever the project is replaced wholesale.** In `new_short`, `load_dsl`, and `load_template` (and any other tool that assigns `session.project = <fresh project>`), set `session.currentSceneId = session.project.scenes?.[0]?.id;` after the assignment (undefined for single-scene → routes to root).

- [ ] **Step 5: Route the object/camera tools through `withScene`.** For each tool whose handler currently does `const r = builder(session.project, …); session.project = r.project;` (add_rect, add_ellipse, add_text, and add_path if present), change to:

```ts
run(session, a) {
  const r = withScene(session.project, session.currentSceneId, (p) => addRect(p, { /* same opts */ }));
  session.project = r.project;
  return edited(session, `Added rect "${r.id}".`);
},
```

  For the `Project`-returning builders (set_keyframe, move_to, fade, set_camera, camera_move), wrap so the helper's `{ project }` contract holds:

```ts
// set_keyframe example
run(session, a) {
  session.project = withScene(session.project, session.currentSceneId, (p) => ({ project: setKeyframe(p, { /* spec */ }) })).project;
  return edited(session, `Set keyframe …`);
},
```

  Apply this uniformly to every object/camera-targeting tool. Camera tools resolve correctly because `withScene`'s scene-view carries `camera: scene.camera` and merges it back.

- [ ] **Step 6: Run, verify pass + parity.** Run: `pnpm test mcp` — Expected: PASS. Run `pnpm test` — Expected: green (single-scene: `currentSceneId` undefined → `withScene` applies directly; `currentSceneTime` returns 0 → `edited` identical to before).

- [ ] **Step 7: Typecheck + commit.**

```bash
pnpm typecheck && pnpm lint
git add src/mcp/tools.ts src/mcp/tools.test.ts
git commit -m "feat(8b-5): MCP Session.currentSceneId + route object/camera tools to current scene + scene-aware thumbnail"
```

---

## Task 4: MCP — the 7 scene tools

**Files:**
- Modify: `src/mcp/tools.ts`
- Test: `src/mcp/tools.test.ts`
- (Verify `src/mcp/server.ts` needs no change — it iterates the `tools` table, so appending registers them. Confirm and note.)

**Interfaces:**
- Consumes: `addScene`/`removeScene`/`reorderScene`/`setSceneDuration`/`setSceneTransition` (Task 1); `Session.currentSceneId` (Task 3).
- Produces (appended to the `tools` array): `add_scene`, `remove_scene`, `reorder_scene`, `set_scene_duration`, `set_scene_transition`, `list_scenes`, `select_scene`.

- [ ] **Step 1: Write the failing tests.** In `src/mcp/tools.test.ts`:

```ts
it('add_scene promotes + selects the new scene; object adds then target it', () => {
  const s = freshSession();
  const r = tool('add_scene').run(s, { name: 'Intro', duration: 2 });
  expect(s.project.scenes!.length).toBe(2);          // root + new
  expect(s.currentSceneId).toBe(s.project.scenes![1].id);
  expect(imageOf(r)!.data).toMatch(/^iVBOR/);
});

it('select_scene switches the target; remove_scene reselects a survivor / demotes', () => {
  const s = freshSession();
  tool('add_scene').run(s, {});                       // 2 scenes, current = scene[1]
  const first = s.project.scenes![0].id;
  tool('select_scene').run(s, { sceneId: first });
  expect(s.currentSceneId).toBe(first);
  tool('remove_scene').run(s, { sceneId: s.project.scenes![1].id }); // remove the non-current → demote to single
  expect(s.project.scenes).toBeUndefined();
  expect(s.currentSceneId).toBeUndefined();
});

it('reorder_scene / set_scene_duration / set_scene_transition mutate the project', () => {
  const s = freshSession();
  tool('add_scene').run(s, {});
  const [a, b] = s.project.scenes!.map((sc) => sc.id);
  tool('reorder_scene').run(s, { sceneId: b, toIndex: 0 });
  expect(s.project.scenes!.map((sc) => sc.id)).toEqual([b, a]);
  tool('set_scene_duration').run(s, { sceneId: a, duration: 3 });
  expect(s.project.scenes!.find((sc) => sc.id === a)!.duration).toBe(3);
  tool('set_scene_transition').run(s, { sceneId: a, kind: 'dip', duration: 0.4, color: '#000' });
  expect(s.project.scenes!.find((sc) => sc.id === a)!.transitionIn).toEqual({ kind: 'dip', duration: 0.4, color: '#000' });
});

it('list_scenes lists ids/names/durations and marks the current scene', () => {
  const s = freshSession();
  tool('add_scene').run(s, { name: 'Two' });
  const out = textOf(tool('list_scenes').run(s));      // textOf = first text content
  expect(out).toContain(s.currentSceneId!);
  expect(out).toMatch(/current|→|\*/i);                // some current-marker
});

it('select_scene throws on unknown id', () => {
  const s = freshSession();
  tool('add_scene').run(s, {});
  expect(() => tool('select_scene').run(s, { sceneId: 'nope' })).toThrow();
});
```

  (Add a `textOf` test helper next to the existing `imageOf` if absent: returns the first `text` content's string.)

- [ ] **Step 2: Run, verify fail.** Run: `pnpm test mcp` — Expected: FAIL (tools not registered).

- [ ] **Step 3: Implement the 7 tools** (append to the `tools` array, mirroring the `edited()`/`obj`/`num`/`str` patterns):

```ts
{
  name: 'add_scene',
  description: 'Add a new empty scene (shot) to the sequence and make it the current target for subsequent object edits. Auto-converts a single-scene short to multi-scene. Optional name, duration (s), afterIndex.',
  inputSchema: obj({ name: str, duration: num, afterIndex: num }),
  run(session, a) {
    const r = addScene(session.project, { name: a.name as string | undefined, duration: a.duration as number | undefined, afterIndex: a.afterIndex as number | undefined });
    session.project = r.project;
    session.currentSceneId = r.sceneId;
    return edited(session, `Added scene "${r.sceneId}" (now current).`);
  },
},
{
  name: 'remove_scene',
  description: 'Remove a scene by id. Reverts to a single-scene short when one scene remains.',
  inputSchema: obj({ sceneId: str }, ['sceneId']),
  run(session, a) {
    session.project = removeScene(session.project, a.sceneId as string);
    if (!session.project.scenes || !session.project.scenes.some((s) => s.id === session.currentSceneId)) {
      session.currentSceneId = session.project.scenes?.[0]?.id;
    }
    return edited(session, `Removed scene "${a.sceneId as string}".`);
  },
},
{
  name: 'reorder_scene',
  description: 'Move a scene to a new index in the play order.',
  inputSchema: obj({ sceneId: str, toIndex: num }, ['sceneId', 'toIndex']),
  run(session, a) {
    session.project = reorderScene(session.project, a.sceneId as string, a.toIndex as number);
    return edited(session, `Reordered scene "${a.sceneId as string}" to index ${a.toIndex as number}.`);
  },
},
{
  name: 'set_scene_duration',
  description: 'Set a scene’s on-screen duration in seconds.',
  inputSchema: obj({ sceneId: str, duration: num }, ['sceneId', 'duration']),
  run(session, a) {
    session.project = setSceneDuration(session.project, a.sceneId as string, a.duration as number);
    return edited(session, `Set scene "${a.sceneId as string}" duration to ${a.duration as number}s.`);
  },
},
{
  name: 'set_scene_transition',
  description: 'Set the transition INTO a scene from the previous one: cut (default), crossfade (needs duration), or dip (needs duration + color). Transition playback renders in a later slice; this sets the data.',
  inputSchema: obj({ sceneId: str, kind: { type: 'string', enum: ['cut', 'crossfade', 'dip'] }, duration: num, color: str }, ['sceneId', 'kind']),
  run(session, a) {
    const kind = a.kind as 'cut' | 'crossfade' | 'dip';
    let transition: Transition;
    if (kind === 'cut') transition = { kind: 'cut' };
    else if (kind === 'crossfade') transition = { kind: 'crossfade', duration: a.duration as number };
    else transition = { kind: 'dip', duration: a.duration as number, color: a.color as string };
    session.project = setSceneTransition(session.project, a.sceneId as string, transition);
    return edited(session, `Set scene "${a.sceneId as string}" transition to ${kind}.`);
  },
},
{
  name: 'select_scene',
  description: 'Make a scene the current target for subsequent object edits (does not change the project).',
  inputSchema: obj({ sceneId: str }, ['sceneId']),
  run(session, a) {
    const id = a.sceneId as string;
    if (!session.project.scenes?.some((s) => s.id === id)) throw new Error(`savig/mcp: no scene with id "${id}"`);
    session.currentSceneId = id;
    return edited(session, `Selected scene "${id}".`);
  },
},
{
  name: 'list_scenes',
  description: 'List the scenes (id, name, duration, object count) in play order, marking the current target scene. Use the ids with select_scene / remove_scene / reorder_scene.',
  inputSchema: obj({}),
  run(session) {
    const scenes = session.project.scenes;
    if (!scenes) return { content: [text('Single-scene short (no scene sequence). Use add_scene to start sequencing.')] };
    const lines = scenes.map((s, i) => `${i}. ${s.id === session.currentSceneId ? '→ ' : '  '}"${s.name}" [${s.id}] — ${s.duration}s, ${s.objects.length} objs${s.transitionIn && s.transitionIn.kind !== 'cut' ? `, ${s.transitionIn.kind}-in` : ''}`);
    return { content: [text(`Scenes (${scenes.length}):\n${lines.join('\n')}`)] };
  },
},
```

  Import `addScene`, `removeScene`, `reorderScene`, `setSceneDuration`, `setSceneTransition`, and the `Transition` type at the top of `tools.ts`. `list_scenes` is read-only (no thumbnail). `select_scene` returns `edited()` so the agent sees the now-current scene's thumbnail.

- [ ] **Step 4: Confirm `server.ts` registration.** Verify `server.ts` builds its tool list from the exported `tools` array (so the 7 new entries register automatically). If it hardcodes a subset, add the new names. Note the result in the report.

- [ ] **Step 5: Run, verify pass + parity.** Run: `pnpm test mcp` — Expected: PASS. Run `pnpm test` — Expected: green.

- [ ] **Step 6: Typecheck + commit.**

```bash
pnpm typecheck && pnpm lint
git add src/mcp/tools.ts src/mcp/tools.test.ts
git commit -m "feat(8b-5): MCP scene tools (add/remove/reorder/set_duration/set_transition/list/select_scene)"
```

---

## Self-Review Notes (spec §11/§12 coverage)

- **Core scene builders** `addScene`/`removeScene`/`reorderScene`/`setSceneDuration`/`setSceneTransition` (pure, auto-promote/demote, fail-loud): Task 1.
- **`setActiveScene` → `Session.currentSceneId`** + object builders target it: Task 3 (`currentSceneId` + `withScene` routing). `select_scene` tool: Task 4.
- **DSL `ShortDoc.scenes`/`ShortScene`, compile/decompile, mutual exclusivity, round-trip:** Task 2.
- **MCP tools** `add_scene`/`remove_scene`/`reorder_scene`/`set_scene_duration`/`set_scene_transition`/`list_scenes`/`select_scene`: Task 4. Object tools write to current scene: Task 3.
- **`describe` lists scenes + per-scene counts + durations:** already shipped (8b-2d stopgap, `describe.ts`) — no change. `list_scenes` adds the scene IDs (which `describe` omits) so the agent can target scenes.
- **Agent perceive-loop:** `edited()` renders the *current* scene's frame (Task 3) so the agent sees the scene it is editing, not always scene 0.
- **Parity:** every task keeps single-scene (`scenes` absent / `currentSceneId` undefined) byte-identical; `pnpm test` (1670 baseline) is the gate.
- **Deferred (NOT this slice):** transition RENDERING (8b-4 — `set_scene_transition` only writes data); `rename_scene` (not in spec's tool set; names via `addScene`/`ShortScene.name`).
