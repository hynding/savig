# M5 Slice 8b-1a — Scene Model (additive) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the optional multi-scene data model (`Project.scenes?`) and its pure headless helpers — timeline math, promotion, scene-aware reference counting, per-scene validation, and migration v5 — with zero behavior change when `scenes` is absent.

**Architecture:** A short becomes an ordered list of `Scene`s (shots) played in sequence on a master timeline. The field is optional and **absent = byte-identical parity**; a single `projectScenes()` accessor synthesizes one scene from `project.objects` when absent. This slice is *additive only* — it adds new types/functions and makes three existing scene-naive readers scene-aware. The parity-risky `computeFrame`/render refactor is deliberately NOT in this slice (it is 8b-1b).

**Tech Stack:** TypeScript (strict), Vitest (`pnpm test` = `vitest run`), pure ESM modules under `src/engine` and `src/core`. No new dependencies.

## Global Constraints

- **Parity discipline:** when `project.scenes` is `undefined`, every function's output MUST be byte-identical to before this slice. New code paths run only when `scenes` is present.
- **Purity:** all new functions are pure (no store, no I/O). They live in `src/engine` (engine helpers) or `src/core` (validate).
- **Cut transitions only** in 8b-1a. `Transition` type includes `crossfade`/`dip` variants for forward-compatibility, but no overlap math is implemented here (that is 8b-4); `resolveTimeline` and `computeProjectDurationMulti` treat every boundary as a hard cut (`Σ duration`).
- **Test runner:** single file → `pnpm test <path>`; full suite → `pnpm test`. Typecheck → `pnpm typecheck`.
- **Factory helpers** (in `src/engine/project.ts`, already imported by existing tests): `createProject(overrides?: Partial<ProjectMeta>)`, `createSceneObject(assetId, overrides?)`, `createVectorAsset(...)`, `createSymbolAsset(overrides?)`, `createKeyframe(time, value)`.
- **Import-cycle note:** `scenes.ts` imports `computeProjectDuration` from `duration.ts`, and `duration.ts` imports `computeProjectDurationMulti` from `scenes.ts`. This is a *function-level* static cycle (each binding is used only inside a function body, never at module top-level), which ESM/Vitest resolve correctly. Do not try to "fix" it by inlining — it is intentional and safe.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/engine/types.ts` | `Scene`, `Transition` types; `Project.scenes?` field | Modify |
| `src/engine/scenes.ts` | `ROOT_SCENE_ID`, `projectScenes`, `resolveTimeline`, `sceneAtTime`, `computeProjectDurationMulti`, `promoteToMultiScene` | Create |
| `src/engine/scenes.test.ts` | Unit tests for `scenes.ts` | Create |
| `src/engine/index.ts` | Re-export `./scenes` | Modify |
| `src/engine/duration.ts` | `computeProjectDuration` → dispatcher | Modify |
| `src/engine/duration.test.ts` | Dispatcher tests | Modify |
| `src/engine/symbol.ts` | `countSymbolInstances` scene-aware (C3) | Modify |
| `src/engine/symbol.test.ts` | Scene-aware count test | Modify |
| `src/engine/removeObject.ts` | `collectReferencedAssetIds` scene-aware (C3) | Modify |
| `src/engine/removeObject.test.ts` | Scene-aware collect test | Modify |
| `src/services/persistence/migrate.ts` | `CURRENT_VERSION = 5` + v4→v5 migration | Modify |
| `src/services/persistence/__fixtures__/project-v4.json` | Committed real v4 project fixture | Create |
| `src/services/persistence/migrate.test.ts` | v4→v5 migration + fixture test | Modify |
| `src/engine/project.ts` | `createProject` default `version: 5` | Modify |
| `src/core/validate.ts` | per-scene validation (I3) + scene-level checks | Modify |
| `src/core/validate.test.ts` | per-scene + scene-check tests | Modify |

---

## Task 1: Scene & Transition types + `Project.scenes?`

**Files:**
- Modify: `src/engine/types.ts` (the `Camera` / `Project` interface region)

**Interfaces:**
- Consumes: existing `SceneObject`, `Camera` types.
- Produces:
  - `type Transition = { kind: 'cut' } | { kind: 'crossfade'; duration: number } | { kind: 'dip'; duration: number; color: string }`
  - `interface Scene { id: string; name: string; objects: SceneObject[]; duration: number; camera?: Camera; transitionIn?: Transition }`
  - `Project.scenes?: Scene[]`

- [ ] **Step 1: Add the types** — in `src/engine/types.ts`, immediately AFTER the `Camera` interface and BEFORE `interface Project`, insert:

```ts
/** A transition INTO a scene from the previous one. `cut` = instant (default; absent ⇒ cut).
 *  `crossfade`/`dip` are authored in 8b-4; their overlap math is not implemented in 8b-1a. */
export type Transition =
  | { kind: 'cut' }
  | { kind: 'crossfade'; duration: number }
  | { kind: 'dip'; duration: number; color: string };

/** One shot in a multi-scene sequence. Scenes play in order on the master timeline.
 *  `objects` is the scene's own scene-graph (same shape as `Project.objects`); `duration` is the
 *  authored on-screen dwell (seconds); `camera` is the per-scene view transform (absent = identity). */
export interface Scene {
  id: string;
  name: string;
  objects: SceneObject[];
  duration: number;
  camera?: Camera;
  transitionIn?: Transition;
}
```

- [ ] **Step 2: Add the field to `Project`** — inside `interface Project`, after the `camera?: Camera;` line, add:

```ts
  /** Multi-scene sequence (8b). Present ⇒ scenes are authoritative and `objects`/`camera` are empty.
   *  Absent ⇒ single-scene project (`objects`/`camera` authoritative) = byte-identical parity. */
  scenes?: Scene[];
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no errors — purely additive optional members).

- [ ] **Step 4: Commit**

```bash
git add src/engine/types.ts
git commit -m "feat(8b-1a): add Scene/Transition types + Project.scenes? (additive)"
```

---

## Task 2: `scenes.ts` — `ROOT_SCENE_ID` + `projectScenes` accessor

**Files:**
- Create: `src/engine/scenes.ts`
- Create: `src/engine/scenes.test.ts`
- Modify: `src/engine/index.ts` (add re-export)

**Interfaces:**
- Consumes: `computeProjectDuration` from `./duration`; `Project`, `Scene` from `./types`.
- Produces:
  - `const ROOT_SCENE_ID = 'scene-root'`
  - `function projectScenes(project: Project): Scene[]` — returns `project.scenes` when present, else a single synthesized scene `{ id: ROOT_SCENE_ID, name: 'Scene 1', objects, camera, duration }`.

- [ ] **Step 1: Write the failing test** — create `src/engine/scenes.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { ROOT_SCENE_ID, projectScenes } from './scenes';
import { createProject, createSceneObject, createVectorAsset } from './project';
import type { Scene } from './types';

describe('projectScenes (8b-1a)', () => {
  test('synthesizes ONE root scene when project.scenes is absent', () => {
    const asset = createVectorAsset();
    const obj = createSceneObject(asset.id, { id: 'o1' });
    const project = { ...createProject({ duration: 3, durationMode: 'manual' }), assets: [asset], objects: [obj] };

    const scenes = projectScenes(project);

    expect(scenes).toHaveLength(1);
    expect(scenes[0].id).toBe(ROOT_SCENE_ID);
    expect(scenes[0].name).toBe('Scene 1');
    expect(scenes[0].objects).toBe(project.objects); // same reference, not a copy
    expect(scenes[0].duration).toBe(3); // = computeProjectDuration (manual)
  });

  test('returns project.scenes verbatim when present', () => {
    const sceneA: Scene = { id: 's-a', name: 'A', objects: [], duration: 2 };
    const project = { ...createProject(), scenes: [sceneA] };

    const scenes = projectScenes(project);

    expect(scenes).toBe(project.scenes); // same array reference
    expect(scenes[0].id).toBe('s-a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/engine/scenes.test.ts`
Expected: FAIL — `Cannot find module './scenes'`.

- [ ] **Step 3: Write minimal implementation** — create `src/engine/scenes.ts`:

```ts
import { computeProjectDuration } from './duration';
import type { Project, Scene } from './types';

/** Stable sentinel id for the single scene synthesized from a single-scene project's root. */
export const ROOT_SCENE_ID = 'scene-root';

/** The project's scenes, or a single synthesized scene from the root when `scenes` is absent.
 *  THE one seam every scene-aware consumer reads through, so the absent case stays parity-safe.
 *  The synthesized scene is a read-only projection — never write it back. */
export function projectScenes(project: Project): Scene[] {
  if (project.scenes) return project.scenes;
  return [
    {
      id: ROOT_SCENE_ID,
      name: 'Scene 1',
      objects: project.objects,
      camera: project.camera,
      duration: computeProjectDuration(project),
    },
  ];
}
```

- [ ] **Step 4: Add the re-export** — in `src/engine/index.ts`, add a line alongside the other `export * from './...'` lines (e.g. after `export * from './duration';`):

```ts
export * from './scenes';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/engine/scenes.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add src/engine/scenes.ts src/engine/scenes.test.ts src/engine/index.ts
git commit -m "feat(8b-1a): projectScenes accessor + ROOT_SCENE_ID"
```

---

## Task 3: `scenes.ts` — `resolveTimeline` + `sceneAtTime` (cut-only)

**Files:**
- Modify: `src/engine/scenes.ts`
- Modify: `src/engine/scenes.test.ts`

**Interfaces:**
- Consumes: `projectScenes`, `Project`, `Scene`.
- Produces:
  - `interface SceneSpan { scene: Scene; index: number; start: number; end: number }`
  - `interface SceneSample { primary: { scene: Scene; localTime: number }; outgoing?: { scene: Scene; localTime: number; progress: number } }`
  - `function resolveTimeline(project: Project): SceneSpan[]` — cumulative `start[i] = Σ duration[0..i-1]`, `end[i] = start[i] + duration[i]`.
  - `function sceneAtTime(project: Project, t: number): SceneSample` — active scene + `localTime = t - span.start`; clamps `t` past the end to the last scene's final frame; `outgoing` always undefined in 8b-1a (cut).

- [ ] **Step 1: Write the failing test** — append to `src/engine/scenes.test.ts`:

```ts
import { resolveTimeline, sceneAtTime } from './scenes';

function multi(durations: number[]) {
  const scenes: Scene[] = durations.map((d, i) => ({ id: `s${i}`, name: `S${i}`, objects: [], duration: d }));
  return { ...createProject(), scenes };
}

describe('resolveTimeline (8b-1a, cut-only)', () => {
  test('cumulative spans, Σ durations', () => {
    const spans = resolveTimeline(multi([2, 3, 1]));
    expect(spans.map((s) => [s.start, s.end])).toEqual([[0, 2], [2, 5], [5, 6]]);
    expect(spans.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  test('single-scene (scenes absent) → one span [0, duration]', () => {
    const p = { ...createProject({ duration: 4, durationMode: 'manual' }) };
    const spans = resolveTimeline(p);
    expect(spans).toHaveLength(1);
    expect([spans[0].start, spans[0].end]).toEqual([0, 4]);
  });
});

describe('sceneAtTime (8b-1a, cut-only)', () => {
  test('picks the active scene and local time within it', () => {
    const p = multi([2, 3, 1]);
    expect(sceneAtTime(p, 0).primary).toMatchObject({ localTime: 0 });
    expect(sceneAtTime(p, 0).primary.scene.id).toBe('s0');
    expect(sceneAtTime(p, 2.5).primary.scene.id).toBe('s1');
    expect(sceneAtTime(p, 2.5).primary.localTime).toBeCloseTo(0.5, 6);
    expect(sceneAtTime(p, 5).primary.scene.id).toBe('s2'); // boundary belongs to the next scene
    expect(sceneAtTime(p, 5).primary.localTime).toBeCloseTo(0, 6);
  });

  test('clamps past-end to the last scene final frame; never returns outgoing in 8b-1a', () => {
    const p = multi([2, 3, 1]); // total 6
    const s = sceneAtTime(p, 99);
    expect(s.primary.scene.id).toBe('s2');
    expect(s.primary.localTime).toBeCloseTo(1, 6); // = last scene duration
    expect(s.outgoing).toBeUndefined();
  });

  test('single-scene → localTime = t', () => {
    const p = { ...createProject({ duration: 4, durationMode: 'manual' }) };
    expect(sceneAtTime(p, 1.5).primary.localTime).toBeCloseTo(1.5, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/engine/scenes.test.ts`
Expected: FAIL — `resolveTimeline`/`sceneAtTime` are not exported.

- [ ] **Step 3: Write minimal implementation** — append to `src/engine/scenes.ts`:

```ts
export interface SceneSpan {
  scene: Scene;
  index: number;
  start: number;
  end: number;
}

export interface SceneSample {
  primary: { scene: Scene; localTime: number };
  /** Present only mid-transition (8b-4); always undefined in 8b-1a (cuts only). */
  outgoing?: { scene: Scene; localTime: number; progress: number };
}

/** Cumulative scene layout on the master timeline. Cut-only: `start[i] = Σ duration[0..i-1]`.
 *  (8b-4 will subtract transition overlaps here.) */
export function resolveTimeline(project: Project): SceneSpan[] {
  const scenes = projectScenes(project);
  const spans: SceneSpan[] = [];
  let cursor = 0;
  scenes.forEach((scene, index) => {
    const start = cursor;
    const end = start + scene.duration;
    spans.push({ scene, index, start, end });
    cursor = end;
  });
  return spans;
}

/** The scene(s) on screen at master time `t`. Cut-only: the active span's scene, `localTime = t -
 *  start`. `t` past the end pins to the last scene's final frame (matches single-scene clamp). */
export function sceneAtTime(project: Project, t: number): SceneSample {
  const spans = resolveTimeline(project);
  const last = spans[spans.length - 1];
  for (const span of spans) {
    // A boundary time belongs to the NEXT scene: [start, end). The last span owns its end.
    if (t < span.end || span === last) {
      const localTime = Math.min(Math.max(0, t - span.start), span.scene.duration);
      return { primary: { scene: span.scene, localTime } };
    }
  }
  // Unreachable (spans is non-empty), but satisfy the type.
  return { primary: { scene: last.scene, localTime: last.scene.duration } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/engine/scenes.test.ts`
Expected: PASS (all scenes tests green).

- [ ] **Step 5: Commit**

```bash
git add src/engine/scenes.ts src/engine/scenes.test.ts
git commit -m "feat(8b-1a): resolveTimeline + sceneAtTime (cut-only master timeline)"
```

---

## Task 4: `scenes.ts` — `promoteToMultiScene`

**Files:**
- Modify: `src/engine/scenes.ts`
- Modify: `src/engine/scenes.test.ts`

**Interfaces:**
- Consumes: `computeProjectDuration`, `ROOT_SCENE_ID`, `Project`, `Scene`.
- Produces: `function promoteToMultiScene(project: Project): Project` — moves root `objects`/`camera`/duration into `scenes[0]` (id `ROOT_SCENE_ID`); clears `objects` to `[]` and `camera` to `undefined`. Idempotent (returns the project unchanged when already multi-scene).

- [ ] **Step 1: Write the failing test** — append to `src/engine/scenes.test.ts`:

```ts
import { promoteToMultiScene } from './scenes';

describe('promoteToMultiScene (8b-1a)', () => {
  test('moves root objects/camera into scenes[0]; clears root', () => {
    const asset = createVectorAsset();
    const obj = createSceneObject(asset.id, { id: 'o1' });
    const base = { ...createProject({ duration: 5, durationMode: 'manual' }), assets: [asset], objects: [obj] };

    const promoted = promoteToMultiScene(base);

    expect(promoted.scenes).toHaveLength(1);
    expect(promoted.scenes![0].id).toBe(ROOT_SCENE_ID);
    expect(promoted.scenes![0].objects).toEqual([obj]);
    expect(promoted.scenes![0].duration).toBe(5);
    expect(promoted.objects).toEqual([]);
    expect(promoted.camera).toBeUndefined();
    expect(promoted.assets).toBe(base.assets); // assets stay global, untouched
  });

  test('is idempotent on an already multi-scene project', () => {
    const p = { ...createProject(), scenes: [{ id: 's0', name: 'S0', objects: [], duration: 1 }] };
    expect(promoteToMultiScene(p)).toBe(p);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/engine/scenes.test.ts`
Expected: FAIL — `promoteToMultiScene` not exported.

- [ ] **Step 3: Write minimal implementation** — append to `src/engine/scenes.ts`:

```ts
/** Promote a single-scene project to multi-scene: the root objects/camera/duration become
 *  `scenes[0]` (id ROOT_SCENE_ID), and the root `objects`/`camera` are cleared so `scenes` is the
 *  sole source of truth (§3 of the spec). Idempotent. Assets stay project-global. */
export function promoteToMultiScene(project: Project): Project {
  if (project.scenes) return project;
  const scene0: Scene = {
    id: ROOT_SCENE_ID,
    name: 'Scene 1',
    objects: project.objects,
    camera: project.camera,
    duration: computeProjectDuration(project),
  };
  return { ...project, objects: [], camera: undefined, scenes: [scene0] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/engine/scenes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/scenes.ts src/engine/scenes.test.ts
git commit -m "feat(8b-1a): promoteToMultiScene (root -> scenes[0], source-of-truth)"
```

---

## Task 5: `computeProjectDurationMulti` + `computeProjectDuration` dispatcher

**Files:**
- Modify: `src/engine/scenes.ts`
- Modify: `src/engine/duration.ts`
- Modify: `src/engine/scenes.test.ts`
- Modify: `src/engine/duration.test.ts`

**Interfaces:**
- Produces (scenes.ts): `function computeProjectDurationMulti(project: Project): number` — `max(Σ scene.duration, Σ audioClip ends)`. Cut-only (no overlap subtraction in 8b-1a).
- Modifies (duration.ts): `computeProjectDuration` gains a first-line dispatch: `if (project.scenes) return computeProjectDurationMulti(project)`. The existing single-scene body is UNCHANGED below it.

- [ ] **Step 1: Write the failing test (multi)** — append to `src/engine/scenes.test.ts`:

```ts
import { computeProjectDurationMulti } from './scenes';

describe('computeProjectDurationMulti (8b-1a, cut-only)', () => {
  test('Σ scene durations', () => {
    expect(computeProjectDurationMulti(multi([2, 3, 1]))).toBeCloseTo(6, 6);
  });

  test('audio tail past the last scene extends the master duration', () => {
    const p = multi([1, 1]); // scenes total 2
    p.audioClips = [{ id: 'a', assetId: 'au', startTime: 1.5, inPoint: 0, outPoint: 3 } as never]; // ends at 4.5
    expect(computeProjectDurationMulti(p)).toBeCloseTo(4.5, 6);
  });
});
```

- [ ] **Step 2: Write the failing test (dispatcher)** — append to `src/engine/duration.test.ts`:

```ts
describe('computeProjectDuration dispatcher (8b-1a)', () => {
  test('multi-scene project returns Σ scene durations, ignoring meta.duration', () => {
    const p = {
      ...createProject({ duration: 99, durationMode: 'manual' }),
      scenes: [
        { id: 's0', name: 'S0', objects: [], duration: 2 },
        { id: 's1', name: 'S1', objects: [], duration: 3 },
      ],
    };
    expect(computeProjectDuration(p)).toBeCloseTo(5, 6);
  });

  test('single-scene project is unchanged (parity)', () => {
    const p = createProject({ duration: 7, durationMode: 'manual' });
    expect(computeProjectDuration(p)).toBe(7);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test src/engine/scenes.test.ts src/engine/duration.test.ts`
Expected: FAIL — `computeProjectDurationMulti` not exported; dispatcher test returns 99 (meta.duration) not 5.

- [ ] **Step 4: Implement `computeProjectDurationMulti`** — append to `src/engine/scenes.ts`:

```ts
/** Master-timeline length of a multi-scene project: `max(Σ scene durations, Σ audioClip ends)`.
 *  Audio lives on the master timeline (per-scene audio is deferred), so a clip tail past the last
 *  scene still extends the project. Cut-only in 8b-1a (8b-4 subtracts transition overlaps). */
export function computeProjectDurationMulti(project: Project): number {
  const scenes = project.scenes ?? [];
  let max = 0;
  for (const scene of scenes) max += scene.duration;
  for (const clip of project.audioClips) {
    const end = clip.startTime + (clip.outPoint - clip.inPoint);
    if (end > max) max = end;
  }
  return max;
}
```

- [ ] **Step 5: Add the dispatcher** — in `src/engine/duration.ts`:
  - Add the import at the top (after the existing `import type { ... } from './types';`):
    ```ts
    import { computeProjectDurationMulti } from './scenes';
    ```
  - Change the FIRST lines of `computeProjectDuration` so the new branch precedes the manual check:
    ```ts
    export function computeProjectDuration(project: Project): number {
      if (project.scenes) return computeProjectDurationMulti(project);
      if (project.meta.durationMode === 'manual') {
        return project.meta.duration;
      }
      // ... existing single-scene body below is UNCHANGED ...
    ```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test src/engine/scenes.test.ts src/engine/duration.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck (confirms the function-level import cycle resolves)**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/engine/scenes.ts src/engine/scenes.test.ts src/engine/duration.ts src/engine/duration.test.ts
git commit -m "feat(8b-1a): computeProjectDurationMulti + duration dispatcher"
```

---

## Task 6: `countSymbolInstances` scene-aware (C3)

**Files:**
- Modify: `src/engine/symbol.ts:38-50` (the `countSymbolInstances` function)
- Modify: `src/engine/symbol.test.ts`

**Interfaces:**
- Modifies: `countSymbolInstances(symId, scene)` — widen the `scene` param to `Pick<Project, 'objects' | 'assets' | 'scenes'>`; count instances across `scene.scenes[i].objects` when `scenes` is present, else `scene.objects`, plus every symbol asset's `objects[]` (unchanged).

- [ ] **Step 1: Write the failing test** — append to `src/engine/symbol.test.ts` (match the file's existing imports; it already imports the factories and `countSymbolInstances`):

```ts
describe('countSymbolInstances — scene-aware (8b-1a, C3)', () => {
  test('counts instances inside project.scenes when scenes is present', () => {
    const sym = createSymbolAsset({ id: 'sym1' });
    const instA = createSceneObject('sym1', { id: 'ia' });
    const instB = createSceneObject('sym1', { id: 'ib' });
    const project = {
      ...createProject(),
      assets: [sym],
      objects: [], // multi-scene: root is empty
      scenes: [
        { id: 's0', name: 'S0', objects: [instA], duration: 1 },
        { id: 's1', name: 'S1', objects: [instB], duration: 1 },
      ],
    };
    expect(countSymbolInstances('sym1', project)).toBe(2);
  });

  test('single-scene path unchanged (parity)', () => {
    const sym = createSymbolAsset({ id: 'sym1' });
    const inst = createSceneObject('sym1', { id: 'ia' });
    const project = { ...createProject(), assets: [sym], objects: [inst] };
    expect(countSymbolInstances('sym1', project)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/engine/symbol.test.ts`
Expected: FAIL — multi-scene case returns 0 (current code reads only `scene.objects`, which is `[]`).

- [ ] **Step 3: Update the implementation** — in `src/engine/symbol.ts`, replace the body of `countSymbolInstances`:

```ts
export function countSymbolInstances(
  symId: string,
  scene: Pick<Project, 'objects' | 'assets' | 'scenes'>,
): number {
  let n = 0;
  const countIn = (objects: SceneObject[]): void => {
    for (const o of objects) if (o.assetId === symId) n++;
  };
  if (scene.scenes) for (const s of scene.scenes) countIn(s.objects);
  else countIn(scene.objects);
  for (const a of scene.assets) if (a.kind === 'symbol') countIn(a.objects);
  return n;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/engine/symbol.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/symbol.ts src/engine/symbol.test.ts
git commit -m "fix(8b-1a): countSymbolInstances reads project.scenes (C3)"
```

---

## Task 7: `collectReferencedAssetIds` scene-aware (C3)

**Files:**
- Modify: `src/engine/removeObject.ts:6-16` (the `collectReferencedAssetIds` function)
- Modify: `src/engine/removeObject.test.ts`

**Interfaces:**
- Modifies: `collectReferencedAssetIds(project)` — collect `assetId`s from `project.scenes[i].objects` when `scenes` present, else `project.objects`, plus every symbol asset's `objects[]` (unchanged).

- [ ] **Step 1: Write the failing test** — append to `src/engine/removeObject.test.ts` (match existing imports; add `createSceneObject`, `createVectorAsset`, `createProject`, `collectReferencedAssetIds` if not already imported):

```ts
describe('collectReferencedAssetIds — scene-aware (8b-1a, C3)', () => {
  test('collects assetIds referenced inside project.scenes', () => {
    const a1 = createVectorAsset();
    const a2 = createVectorAsset();
    const project = {
      ...createProject(),
      assets: [a1, a2],
      objects: [],
      scenes: [
        { id: 's0', name: 'S0', objects: [createSceneObject(a1.id, { id: 'o1' })], duration: 1 },
        { id: 's1', name: 'S1', objects: [createSceneObject(a2.id, { id: 'o2' })], duration: 1 },
      ],
    };
    const ids = collectReferencedAssetIds(project);
    expect(ids.has(a1.id)).toBe(true);
    expect(ids.has(a2.id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/engine/removeObject.test.ts`
Expected: FAIL — neither id collected (current code reads only `project.objects`, which is `[]`).

- [ ] **Step 3: Update the implementation** — in `src/engine/removeObject.ts`, replace the body of `collectReferencedAssetIds`:

```ts
export function collectReferencedAssetIds(project: Project): Set<string> {
  const ids = new Set<string>();
  const add = (objects: SceneObject[]): void => {
    for (const o of objects) if (o.assetId) ids.add(o.assetId);
  };
  if (project.scenes) for (const s of project.scenes) add(s.objects);
  else add(project.objects);
  for (const a of project.assets) if (a.kind === 'symbol') add(a.objects);
  return ids;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/engine/removeObject.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/removeObject.ts src/engine/removeObject.test.ts
git commit -m "fix(8b-1a): collectReferencedAssetIds reads project.scenes (C3)"
```

---

## Task 8: Migration v5 + committed v4 fixture

**Files:**
- Modify: `src/services/persistence/migrate.ts`
- Create: `src/services/persistence/__fixtures__/project-v4.json`
- Modify: `src/services/persistence/migrate.test.ts`
- Modify: `src/engine/project.ts` (`createProject` default `version: 5`)

**Interfaces:**
- Modifies: `CURRENT_VERSION = 5`; `migrations[4] = (doc) => ({ ...doc, meta: { ...doc.meta, version: 5 } })` (no-op shape bump — absent `scenes` is already the valid single-scene representation).

- [ ] **Step 1: Create the v4 fixture** — create `src/services/persistence/__fixtures__/project-v4.json` (a real, minimal v4 project as it would appear in a `.savig`'s `project.json`):

```json
{
  "meta": { "name": "Legacy v4", "width": 1280, "height": 720, "fps": 30, "duration": 4, "durationMode": "manual", "loop": false, "version": 4 },
  "assets": [{ "id": "vec1", "kind": "vector", "name": "Rect", "svg": "<rect width=\"10\" height=\"10\"/>", "viewBox": "0 0 10 10" }],
  "objects": [{ "id": "o1", "name": "Rect 1", "assetId": "vec1", "zOrder": 0, "anchorX": 0.5, "anchorY": 0.5, "base": { "x": 100, "y": 100, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1 }, "tracks": {} }],
  "audioClips": []
}
```

> NOTE: if `pnpm typecheck`/load rejects any field, open `src/engine/project.ts` `createVectorAsset`/`createSceneObject` and mirror their exact required fields into this JSON. The fixture must be a *loadable* v4 project.

- [ ] **Step 2: Write the failing test** — append to `src/services/persistence/migrate.test.ts`:

```ts
import v4fixture from './__fixtures__/project-v4.json';

describe('migration v4 -> v5 (8b-1a)', () => {
  test('stamps version 5, leaves scenes absent, preserves objects (parity)', () => {
    const migrated = migrateProject(structuredClone(v4fixture));
    expect(migrated.meta.version).toBe(5);
    expect((migrated as { scenes?: unknown }).scenes).toBeUndefined();
    expect(migrated.objects).toHaveLength(1);
    expect(migrated.objects[0].id).toBe('o1');
  });

  test('CURRENT_VERSION is 5', () => {
    expect(CURRENT_VERSION).toBe(5);
  });
});
```

> If `migrate.test.ts` does not already import `migrateProject` / `CURRENT_VERSION`, add them to its top import from `./migrate`. Ensure `tsconfig`/Vitest allows JSON imports (Vite does by default; `resolveJsonModule` is on in this repo's tsconfig — verify with `pnpm typecheck` in Step 4).

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test src/services/persistence/migrate.test.ts`
Expected: FAIL — `migrated.meta.version` is 4 (no v4→v5 migration); `CURRENT_VERSION` is 4.

- [ ] **Step 4: Implement the migration** — in `src/services/persistence/migrate.ts`:
  - Change `export const CURRENT_VERSION = 4;` → `export const CURRENT_VERSION = 5;`
  - Add to the `migrations` map (and extend the comment block):
    ```ts
    // v4 -> v5 introduced multi-scene sequencing (Project.scenes, optional). Old files have no
    // `scenes` key, which is already the valid single-scene representation, so this only stamps
    // the version (absent scenes = byte-identical parity).
    4: (doc) => ({ ...doc, meta: { ...doc.meta, version: 5 } }),
    ```
  - In `src/engine/project.ts` `createProject`, change the default `version: 4,` → `version: 5,` (new projects are current-version).

- [ ] **Step 5: Run test + typecheck to verify they pass**

Run: `pnpm test src/services/persistence/migrate.test.ts && pnpm typecheck`
Expected: PASS. (If other tests asserted `version: 4` on `createProject` output, update them to `5` — search: `grep -rn "version.*4" src/**/*.test.ts` and fix any that assert the factory default.)

- [ ] **Step 6: Commit**

```bash
git add src/services/persistence/migrate.ts src/services/persistence/__fixtures__/project-v4.json src/services/persistence/migrate.test.ts src/engine/project.ts
git commit -m "feat(8b-1a): migration v4->v5 (no-op bump) + committed v4 fixture"
```

---

## Task 9: Per-scene validation (I3) + scene-level checks

**Files:**
- Modify: `src/core/validate.ts`
- Modify: `src/core/validate.test.ts`

**Interfaces:**
- Refactor: extract the per-object loop into `validateSceneObjects(objects, ctx)` where `ctx = { assetIds, width, height, duration }`; build a fresh `objectIds` set per scene (parent refs resolve within a scene). `validateProject` iterates `projectScenes(project)` and runs the object checks per scene, then runs symbol-cycle checks (project-global, unchanged) and NEW scene-level checks (only when `project.scenes` present).
- New scene-level checks: non-empty `objects` alongside present `scenes` (`code: 'scenes-objects-conflict'`, error); empty `scenes` array (`'empty-scenes'`, error); scene `duration <= 0` (`'scene-nonpositive-duration'`, error); duplicate scene ids (`'duplicate-scene-id'`, error); `transitionIn` on `scenes[0]` (`'transition-on-first-scene'`, warn); `transitionIn.duration` exceeding either adjacent scene's duration (`'transition-too-long'`, warn).

- [ ] **Step 1: Write the failing tests** — append to `src/core/validate.test.ts`:

```ts
describe('validateProject — multi-scene (8b-1a, I3)', () => {
  test('runs per-object checks inside each scene (dangling asset caught in scene 1)', () => {
    const project = {
      ...createProject(),
      assets: [],
      objects: [],
      scenes: [
        { id: 's0', name: 'S0', objects: [], duration: 1 },
        { id: 's1', name: 'S1', objects: [createSceneObject('missing', { id: 'o1' })], duration: 1 },
      ],
    };
    const issues = validateProject(project);
    expect(issues.some((i) => i.code === 'dangling-asset' && i.objectId === 'o1')).toBe(true);
  });

  test('flags scenes/objects source-of-truth conflict', () => {
    const project = {
      ...createProject(),
      objects: [createSceneObject('x', { id: 'stray' })],
      scenes: [{ id: 's0', name: 'S0', objects: [], duration: 1 }],
    };
    expect(validateProject(project).some((i) => i.code === 'scenes-objects-conflict')).toBe(true);
  });

  test('flags non-positive scene duration and duplicate scene ids', () => {
    const project = {
      ...createProject(),
      objects: [],
      scenes: [
        { id: 'dup', name: 'A', objects: [], duration: 0 },
        { id: 'dup', name: 'B', objects: [], duration: 1 },
      ],
    };
    const codes = validateProject(project).map((i) => i.code);
    expect(codes).toContain('scene-nonpositive-duration');
    expect(codes).toContain('duplicate-scene-id');
  });

  test('warns on transitionIn set on the first scene', () => {
    const project = {
      ...createProject(),
      objects: [],
      scenes: [{ id: 's0', name: 'S0', objects: [], duration: 1, transitionIn: { kind: 'cut' as const } }],
    };
    expect(validateProject(project).some((i) => i.code === 'transition-on-first-scene')).toBe(true);
  });

  test('single-scene project validation is unchanged (parity)', () => {
    const project = { ...createProject(), objects: [createSceneObject('missing', { id: 'o1' })] };
    expect(validateProject(project).some((i) => i.code === 'dangling-asset')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/core/validate.test.ts`
Expected: FAIL — multi-scene per-object checks find nothing (loop reads empty `project.objects`); new codes not emitted.

- [ ] **Step 3: Refactor + implement** — rewrite `src/core/validate.ts`. Add `projectScenes` to the engine import, extract the per-object loop, and add scene-level checks:

```ts
import { computeProjectDuration, projectScenes, symbolContains } from '../engine';
import type { Project, Scene, SceneObject, Transform2D } from '../engine';

export interface ValidationIssue {
  severity: 'error' | 'warn';
  code: string;
  message: string;
  objectId?: string;
}

const KF_EPS = 1e-6;

interface SceneCtx { assetIds: Set<string>; width: number; height: number; duration: number; }

function validateSceneObjects(objects: SceneObject[], ctx: SceneCtx, issues: ValidationIssue[]): void {
  const { assetIds, width, height, duration } = ctx;
  const objectIds = new Set(objects.map((o) => o.id));
  for (const o of objects) {
    if (!o.isGroup && o.assetId && !assetIds.has(o.assetId)) {
      issues.push({ severity: 'error', code: 'dangling-asset', message: `object "${o.id}" references missing asset "${o.assetId}"`, objectId: o.id });
    }
    if (o.parentId && !objectIds.has(o.parentId)) {
      issues.push({ severity: 'error', code: 'dangling-parent', message: `object "${o.id}" references missing parent "${o.parentId}"`, objectId: o.id });
    }
    for (const [k, v] of Object.entries(o.base) as [keyof Transform2D, number][]) {
      if (!Number.isFinite(v)) {
        issues.push({ severity: 'error', code: 'non-finite-transform', message: `object "${o.id}" base.${k} is not finite`, objectId: o.id });
      }
    }
    if (o.base.x <= -width || o.base.x >= width * 2 || o.base.y <= -height || o.base.y >= height * 2) {
      issues.push({ severity: 'warn', code: 'off-artboard', message: `object "${o.id}" base position (${o.base.x}, ${o.base.y}) is well outside the ${width}×${height} artboard`, objectId: o.id });
    }
    for (const [prop, track] of Object.entries(o.tracks)) {
      if (!track || track.length === 0) continue;
      if (track.length === 1) {
        issues.push({ severity: 'warn', code: 'single-keyframe', message: `object "${o.id}" track "${prop}" has a single keyframe (no animation — use the base transform instead)`, objectId: o.id });
      }
      for (const kf of track) {
        if (!Number.isFinite(kf.value)) {
          issues.push({ severity: 'error', code: 'non-finite-keyframe', message: `object "${o.id}" track "${prop}" has a non-finite keyframe value`, objectId: o.id });
        }
        if (kf.time > duration + KF_EPS) {
          issues.push({ severity: 'warn', code: 'keyframe-past-duration', message: `object "${o.id}" track "${prop}" has a keyframe at ${kf.time}s, past the project duration ${duration}s`, objectId: o.id });
        }
        if (kf.time < -KF_EPS) {
          issues.push({ severity: 'error', code: 'negative-keyframe-time', message: `object "${o.id}" track "${prop}" has a keyframe at negative time ${kf.time}s`, objectId: o.id });
        }
      }
    }
  }
}

function validateScenes(scenes: Scene[], issues: ValidationIssue[]): void {
  if (scenes.length === 0) {
    issues.push({ severity: 'error', code: 'empty-scenes', message: 'project.scenes is present but empty' });
    return;
  }
  const seen = new Set<string>();
  scenes.forEach((s, i) => {
    if (s.duration <= 0) {
      issues.push({ severity: 'error', code: 'scene-nonpositive-duration', message: `scene "${s.id}" has non-positive duration ${s.duration}` });
    }
    if (seen.has(s.id)) {
      issues.push({ severity: 'error', code: 'duplicate-scene-id', message: `duplicate scene id "${s.id}"` });
    }
    seen.add(s.id);
    if (s.transitionIn && i === 0) {
      issues.push({ severity: 'warn', code: 'transition-on-first-scene', message: `scene "${s.id}" has a transitionIn but is first (ignored)` });
    }
    if (s.transitionIn && s.transitionIn.kind !== 'cut' && i > 0) {
      const d = s.transitionIn.duration;
      if (d > s.duration + KF_EPS || d > scenes[i - 1].duration + KF_EPS) {
        issues.push({ severity: 'warn', code: 'transition-too-long', message: `scene "${s.id}" transition (${d}s) exceeds an adjacent scene's duration` });
      }
    }
  });
}

export function validateProject(project: Project): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const duration = computeProjectDuration(project);
  const assetIds = new Set(project.assets.map((a) => a.id));
  const { width, height } = project.meta;

  // Source-of-truth invariant (§3): scenes present ⇒ root objects must be empty.
  if (project.scenes && project.objects.length > 0) {
    issues.push({ severity: 'error', code: 'scenes-objects-conflict', message: 'project.scenes is present but project.objects is non-empty (source-of-truth violation)' });
  }

  const ctx: SceneCtx = { assetIds, width, height, duration };
  for (const scene of projectScenes(project)) {
    validateSceneObjects(scene.objects, ctx, issues);
  }

  // Symbol cycles (project-global, unchanged).
  for (const a of project.assets) {
    if (a.kind === 'symbol' && symbolContains(a.id, a.id, project.assets)) {
      issues.push({ severity: 'error', code: 'symbol-cycle', message: `symbol "${a.id}" (${a.name}) transitively contains itself` });
    }
  }

  // Scene-level checks (only when truly multi-scene).
  if (project.scenes) validateScenes(project.scenes, issues);

  return issues;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/core/validate.test.ts`
Expected: PASS (new multi-scene tests + all existing single-scene tests green — the refactor preserves the exact issue codes/messages).

- [ ] **Step 5: Commit**

```bash
git add src/core/validate.ts src/core/validate.test.ts
git commit -m "feat(8b-1a): per-scene validation + scene-level checks (I3)"
```

---

## Task 10: Full-suite green + parity sweep

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `pnpm test`
Expected: PASS — all prior tests plus the ~15 new 8b-1a tests. If any pre-existing test fails, it is almost certainly an assertion on `createProject().meta.version === 4` (now 5) — fix those specific assertions to `5` and re-run. No other behavior changed.

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS for both.

- [ ] **Step 3: Parity spot-check (manual reasoning + grep)**

Confirm no single-scene code path changed: `computeProjectDuration` only added a leading `if (project.scenes)`; `countSymbolInstances`/`collectReferencedAssetIds` only added an `if (scenes)` branch *before* the existing `objects` branch; `validateProject` routes single-scene through `projectScenes` which returns one scene wrapping `project.objects` (same objects, same `duration`, same checks). No export markup, runtime, or `computeFrame` touched (those are 8b-1b / 8b-2).

Run: `git diff --stat main...HEAD`
Expected: only the files listed in this plan's File Structure table.

- [ ] **Step 4: Final commit (if any fixups in Step 1)**

```bash
git add -A
git commit -m "test(8b-1a): bump createProject version assertions to v5; full suite green"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** 8b-1a's spec scope — `Project.scenes?`/`Scene`/`Transition` (T1), `projectScenes` (T2), `engine/scenes.ts` `resolveTimeline`/`sceneAtTime`/`computeProjectDurationMulti` incl. audio (T3, T5), `computeProjectDuration` dispatcher (T5), `promoteToMultiScene` (T4), scene-aware `countSymbolInstances` + `collectReferencedAssetIds` C3 (T6, T7), migration v5 + v4 fixture (T8), per-scene `validate` I3 (T9), cut-only — all mapped to tasks. NOT in this slice (correctly deferred): `computeFrame`/`flattenObjects` refactor + scene-id prefix (8b-1b); export/runtime/raster (8b-2); editor (8b-3); transitions overlap (8b-4); DSL/MCP (8b-5).
- **Placeholder scan:** none — every code step contains complete code; the one conditional instruction (fixture field-mirroring in T8/S1, version-assertion fixups in T10/S1) is a bounded, explicit verification step, not a deferred implementation.
- **Type consistency:** `Scene`/`Transition`/`SceneSpan`/`SceneSample` names and shapes are consistent across T1, T3, T9. `projectScenes`/`computeProjectDurationMulti`/`promoteToMultiScene`/`resolveTimeline`/`sceneAtTime` signatures match between their producing task and every consumer. `countSymbolInstances`'s widened `Pick<..., 'scenes'>` param is consistent with its multi-scene test.
