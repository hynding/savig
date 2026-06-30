# M5 Slice 8b-3 — Multi-scene Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the editor multi-scene-aware — a scene strip to add/select/reorder/rename/delete scenes and set per-scene duration, with all object/keyframe editing routed to the selected scene, while single-scene projects stay byte-identical.

**Architecture:** Scenes are a **second active-scene axis** layered under the existing slice-47 symbol axis. A new transient `selectedSceneId` selects the scene; the symbol axis (`editPath`) still wins when inside a symbol (symbols are project-global). All editing flows through a small set of choke-point helpers (`selectActiveObjects`/`selectActiveScope`/`writeSceneObjects`) that gain a "scene base" resolution step. **Time model (decided): per-scene local** — `s.time` is local to the selected scene and the transport/playback are bounded to that scene's duration, mirroring today's in-symbol editing. A master-timeline scrub is deferred to 8b-4.

**Tech Stack:** TypeScript (strict), React 18, Zustand, Vitest (unit), Playwright (e2e), Vite. pnpm.

## Global Constraints

- **Absent = byte-identical parity.** A single-scene project (`project.scenes` absent) must render, compute, export, and serialize exactly as before. Every scene seam reads through `projectScenes` / the scope helpers; nothing else branches on `scenes` presence. Parity is the gate on every task.
- **`selectedSceneId` is transient** (UI view state) — it lives in `TRANSIENT_DEFAULTS`, never in `history`, exactly like `editPath`.
- **Two-axis precedence:** symbol axis (`editPath.at(-1)`, a global symbol asset id) takes precedence; when it is null/absent the **scene base** (`selectedSceneId` → that scene's `objects[]`, or `project.objects` single-scene) governs.
- **Source-of-truth rule:** when `scenes` is present, `project.objects` is `[]` and `project.camera` is `undefined`; scenes are authoritative. Promotion/demotion go through the commit gate (undoable).
- **`ROOT_SCENE_ID = 'scene-root'`** (from `engine/scenes.ts`). All scenes share the project artboard (`meta.width/height`) — `Scene` has **no** width/height.
- Run the full unit suite with `pnpm test`, typecheck with `pnpm typecheck`, lint with `pnpm lint`, e2e with `pnpm e2e`. Baseline before this slice: **1646 unit** tests green.
- Commit after every task (frequent commits). Each task is its own reviewable unit; do not merge to `main` until its `feature-dev:code-reviewer` pass is clean.

---

## File Structure

- `src/ui/store/store-internals.ts` — `TRANSIENT_DEFAULTS` (+`selectedSceneId`), `SceneScope` type, scene-aware write helpers (`writeSceneObjects` core + `withSceneObjects`/`appendToScene`/`replaceObjectInScene`/`appendObjectToScene`/`sceneObjectsOf`), `clearStaleSelection`.
- `src/ui/store/selectors.ts` — `selectActiveSceneId`, `selectActiveScope`, `selectActiveSceneCamera`, `selectEditDuration`; scene-base step inside `selectActiveObjects`/`selectEditProject`.
- `src/ui/store/store.ts` — route direct `project.objects` readers (`addObject`, `duplicateSelected`, `setPrimitiveParam`, `drawOn`); update `commitActiveScene`, `undo`/`redo` to pass `selectedSceneId`.
- `src/ui/store/slices/scenesSlice.ts` — **new** scene actions (`addScene`/`deleteScene`/`reorderScene`/`renameScene`/`setSceneDuration`/`selectScene`).
- `src/ui/store/slices/transportPrefsSlice.ts` — `seek`/`stepFrame` clamp to `selectEditDuration`.
- `src/ui/playback/usePlayback.ts` — playback loop bounded to `selectEditDuration`.
- `src/engine/scenes.ts` — **new** `demoteToSingleScene` (inverse of `promoteToMultiScene`).
- `src/ui/components/Stage/Stage.tsx` — focused-project memo uses scene-view (`camera`+`scenes:undefined`).
- `src/ui/components/AssetPanel/thumbnailSvg.ts` — **new** `sceneThumbnailSvg`.
- `src/ui/components/SceneStrip/SceneStrip.tsx` + `SceneStrip.module.css` — **new** scene strip UI.
- `src/ui/App.tsx` — mount `<SceneStrip />` in the timeline section.
- `e2e/scenes-editor.spec.ts` — **new** multi-scene editor e2e.

---

## Task 1: Scene-base read resolution (state + selectors, parity gate)

**Files:**
- Modify: `src/ui/store/store-internals.ts` (`TRANSIENT_DEFAULTS`, add `SceneScope` type)
- Modify: `src/ui/store/selectors.ts` (`selectActiveObjects`, `selectEditProject`, new selectors)
- Test: `src/ui/store/selectors.test.ts` (create if absent) and/or `src/ui/store/store.test.ts`

**Interfaces:**
- Produces: `interface SceneScope { sceneId: string | null; assetId: string | null }` (in `store-internals.ts`); `selectActiveSceneId(s): string | null`; `selectActiveScope(s): SceneScope`; `selectActiveSceneCamera(s): Camera | undefined` (in `selectors.ts`).
- Consumes: `projectScenes`, `ROOT_SCENE_ID` from `../../engine` (re-exported) or `../../engine/scenes`; existing `selectActiveAssetId`.

- [ ] **Step 1: Add `selectedSceneId` to transient defaults.** In `store-internals.ts`, find `TRANSIENT_DEFAULTS` and add `selectedSceneId: null as string | null,` next to `editPath`. Add `selectedSceneId: string | null;` to the `EditorState` interface near `editPath`. Add the `SceneScope` type at the top of the helpers section:

```ts
/** The two-axis active-scene scope: the selected SCENE (multi-scene) and the entered SYMBOL
 *  (slice 47). Symbol wins when set; else the scene base governs the root objects[]. */
export interface SceneScope {
  sceneId: string | null;
  assetId: string | null;
}
```

- [ ] **Step 2: Write failing selector tests.** In `src/ui/store/selectors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { promoteToMultiScene } from '../../engine/scenes';
import { createProject, createSceneObject } from '../../engine';
import { selectActiveObjects, selectActiveSceneId, selectActiveScope, selectEditProject } from './selectors';
import type { EditorState } from './store-internals';

function stateOf(project: ReturnType<typeof createProject>, over: Partial<EditorState> = {}): EditorState {
  return { history: { present: project, past: [], future: [] }, editPath: [], selectedSceneId: null, ...over } as EditorState;
}

describe('scene-base resolution', () => {
  it('single-scene: selectActiveObjects returns project.objects (parity ref)', () => {
    const p = { ...createProject(), objects: [createSceneObject('a')] };
    const s = stateOf(p);
    expect(selectActiveObjects(s)).toBe(p.objects);
    expect(selectActiveSceneId(s)).toBeNull();
    expect(selectEditProject(s)).toBe(p); // unchanged ref => no spurious rerender
  });

  it('multi-scene: selectActiveObjects returns the selected scene objects', () => {
    const p = promoteToMultiScene({ ...createProject(), objects: [createSceneObject('a')] });
    const sceneId = p.scenes![0].id;
    const s = stateOf(p, { selectedSceneId: sceneId });
    expect(selectActiveObjects(s)).toBe(p.scenes![0].objects);
    expect(selectActiveScope(s)).toEqual({ sceneId, assetId: null });
  });

  it('multi-scene: selectedSceneId null defaults to scene 0', () => {
    const p = promoteToMultiScene({ ...createProject(), objects: [createSceneObject('a')] });
    const s = stateOf(p, { selectedSceneId: null });
    expect(selectActiveSceneId(s)).toBe(p.scenes![0].id);
  });

  it('multi-scene: selectEditProject builds a single-scene view (scenes undefined, scene camera)', () => {
    const cam = { keyframes: { panX: [], panY: [], zoom: [], roll: [] } } as any;
    const base = promoteToMultiScene({ ...createProject(), objects: [createSceneObject('a')] });
    const p = { ...base, scenes: [{ ...base.scenes![0], camera: cam }] };
    const s = stateOf(p, { selectedSceneId: p.scenes![0].id });
    const view = selectEditProject(s);
    expect(view.scenes).toBeUndefined();
    expect(view.objects).toBe(p.scenes![0].objects);
    expect(view.camera).toBe(cam);
  });
});
```

- [ ] **Step 3: Run tests, verify they fail.** Run: `pnpm test selectors` — Expected: FAIL (`selectActiveSceneId` undefined, multi-scene cases wrong).

- [ ] **Step 4: Implement the selectors.** In `selectors.ts`, add imports and the new selectors, and update `selectActiveObjects`/`selectEditProject`:

```ts
import type { Camera } from '../../engine';
// (selectActiveAssetId already defined above)

/** The selected scene id in multi-scene mode (defaulting to scene 0 when `selectedSceneId` is
 *  null or stale), or null for single-scene projects. */
export function selectActiveSceneId(s: EditorState): string | null {
  const scenes = s.history.present.scenes;
  if (!scenes) return null;
  return scenes.some((sc) => sc.id === s.selectedSceneId) ? s.selectedSceneId : (scenes[0]?.id ?? null);
}

export function selectActiveScope(s: EditorState): SceneScope {
  return { sceneId: selectActiveSceneId(s), assetId: selectActiveAssetId(s) };
}

/** The camera governing the active edit view: the selected scene's camera at the scene base,
 *  else the project camera (parity: single-scene & symbol-edit keep project.camera). */
export function selectActiveSceneCamera(s: EditorState): Camera | undefined {
  const present = s.history.present;
  if (selectActiveAssetId(s) == null && present.scenes) {
    const id = selectActiveSceneId(s);
    return present.scenes.find((sc) => sc.id === id)?.camera;
  }
  return present.camera;
}
```

Replace `selectActiveObjects` and `selectEditProject` with the two-axis versions (import `SceneScope` is not needed here — only the selectors):

```ts
export function selectActiveObjects(s: EditorState): SceneObject[] {
  const present = s.history.present;
  const assetId = selectActiveAssetId(s);
  if (assetId) {
    const a = present.assets.find((x) => x.id === assetId);
    if (a && a.kind === 'symbol') return a.objects; // symbol axis (project-global, scene-independent)
  }
  if (present.scenes) {
    const id = selectActiveSceneId(s);
    const sc = present.scenes.find((x) => x.id === id);
    if (sc) return sc.objects; // scene base
  }
  return present.objects; // single-scene root (parity) / missing-asset fallback
}

// Focused project for the active edit view. Single-scene root => the SAME present ref (no
// spurious rerender, parity). A focused sub-scene (symbol or scene) => a single-scene VIEW:
// objects swapped, scenes stripped, camera resolved — so the render/compute path samples THESE
// objects at the local `time` (mirrors 8b-1b's computeFrameForScene scene-view).
export function selectEditProject(s: EditorState): Project {
  const present = s.history.present;
  const objs = selectActiveObjects(s);
  if (objs === present.objects) return present;
  return { ...present, objects: objs, camera: selectActiveSceneCamera(s), scenes: undefined };
}
```

- [ ] **Step 5: Run tests, verify pass + parity.** Run: `pnpm test selectors && pnpm test store` — Expected: PASS. Run `pnpm test` — Expected: all prior tests still green (1646), proving single-scene parity (the `objs === present.objects` short-circuit returns the same ref).

- [ ] **Step 6: Typecheck + commit.**

```bash
pnpm typecheck && pnpm lint
git add src/ui/store/store-internals.ts src/ui/store/selectors.ts src/ui/store/selectors.test.ts
git commit -m "feat(8b-3): scene-base read resolution (selectedSceneId, two-axis selectActiveObjects/EditProject)"
```

---

## Task 2: Scene-aware write helpers + clearStaleSelection

**Files:**
- Modify: `src/ui/store/store-internals.ts` (`sceneObjectsOf`, `withSceneObjects`, `appendToScene`, `replaceObjectInScene`, `appendObjectToScene`, new `writeSceneObjects`, `clearStaleSelection`)
- Modify: `src/ui/store/store.ts` (`commitActiveScene`, `undo`, `redo` call sites)
- Test: `src/ui/store/store-internals.test.ts` (create if absent)

**Interfaces:**
- Consumes: `SceneScope` (Task 1).
- Produces (signature changes — all `activeAssetId: string | null` → `scope: SceneScope`): `sceneObjectsOf(project, scope)`, `withSceneObjects(project, scope, objects)`, `appendToScene(project, scope, obj)`, `replaceObjectInScene(project, scope, next)`, `appendObjectToScene(project, scope, asset, obj)`. `clearStaleSelection(history, editPath, selectedSceneId, ids) → { selectedObjectIds, selectedObjectId, selectedSceneId }`.

- [ ] **Step 1: Write failing write-helper tests.** In `src/ui/store/store-internals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { promoteToMultiScene } from '../../engine/scenes';
import { createProject, createSceneObject } from '../../engine';
import { withSceneObjects, appendToScene, replaceObjectInScene, sceneObjectsOf } from './store-internals';

const multi = () => promoteToMultiScene({ ...createProject(), objects: [createSceneObject('a')] });

describe('scene-aware write helpers', () => {
  it('writes the active scene, leaving project.objects empty in multi-scene', () => {
    const p = multi();
    const sceneId = p.scenes![0].id;
    const obj = createSceneObject('b');
    const next = appendToScene(p, { sceneId, assetId: null }, obj);
    expect(next.objects).toEqual([]); // root stays empty (source-of-truth rule)
    expect(next.scenes![0].objects.map((o) => o.id)).toContain(obj.id);
  });

  it('single-scene: writes project.objects (parity)', () => {
    const p = { ...createProject(), objects: [createSceneObject('a')] };
    const obj = createSceneObject('b');
    const next = appendToScene(p, { sceneId: null, assetId: null }, obj);
    expect(next.objects.map((o) => o.id)).toContain(obj.id);
    expect(next.scenes).toBeUndefined();
  });

  it('symbol axis wins over scene base', () => {
    const p = multi();
    // (a symbol asset would be added by the editor; here assert assetId routes to assets even with sceneId set)
    expect(sceneObjectsOf(p, { sceneId: p.scenes![0].id, assetId: 'missing' })).toBe(p.scenes![0].objects);
  });
});
```

- [ ] **Step 2: Run tests, verify fail.** Run: `pnpm test store-internals` — Expected: FAIL (helpers take `activeAssetId`, not `scope`; multi-scene routing absent).

- [ ] **Step 3: Implement `writeSceneObjects` core + refactor the helpers.** In `store-internals.ts`, replace the bodies of `sceneObjectsOf`/`withSceneObjects`/`appendToScene`/`replaceObjectInScene`/`appendObjectToScene` with scope-based versions over a shared core:

```ts
/** The active scene's objects[] for a scope: the entered symbol's objects (symbol wins), else the
 *  selected scene's objects (multi-scene), else root project.objects. Read dual of writeSceneObjects. */
export function sceneObjectsOf(project: Project, scope: SceneScope): SceneObject[] {
  if (scope.assetId) {
    const a = project.assets.find((x) => x.id === scope.assetId);
    if (a && a.kind === 'symbol') return a.objects;
  }
  if (scope.sceneId && project.scenes) {
    const sc = project.scenes.find((x) => x.id === scope.sceneId);
    if (sc) return sc.objects;
  }
  return project.objects;
}

/** Apply `map` to the active scene's objects[] in place within the project (symbol > scene > root).
 *  The single write seam; all scene-aware writers compose it. */
function writeSceneObjects(
  project: Project,
  scope: SceneScope,
  map: (objects: SceneObject[]) => SceneObject[],
): Project {
  if (scope.assetId) {
    const a = project.assets.find((x) => x.id === scope.assetId);
    if (a && a.kind === 'symbol') {
      return {
        ...project,
        assets: project.assets.map((x) =>
          x.id === scope.assetId && x.kind === 'symbol' ? { ...x, objects: map(x.objects) } : x,
        ),
      };
    }
  }
  if (scope.sceneId && project.scenes) {
    return {
      ...project,
      scenes: project.scenes.map((sc) => (sc.id === scope.sceneId ? { ...sc, objects: map(sc.objects) } : sc)),
    };
  }
  return { ...project, objects: map(project.objects) };
}

export function withSceneObjects(project: Project, scope: SceneScope, objects: SceneObject[]): Project {
  return writeSceneObjects(project, scope, () => objects);
}

export function appendToScene(project: Project, scope: SceneScope, obj: SceneObject): Project {
  return writeSceneObjects(project, scope, (o) => [...o, obj]);
}

export function replaceObjectInScene(project: Project, scope: SceneScope, next: SceneObject): Project {
  return writeSceneObjects(project, scope, (o) => o.map((x) => (x.id === next.id ? next : x)));
}

export function appendObjectToScene(project: Project, scope: SceneScope, asset: Asset, obj: SceneObject): Project {
  return appendToScene({ ...project, assets: [...project.assets, asset] }, scope, obj);
}
```

Note: the standalone `replaceObject(project, next)` (root-only) stays unchanged for any non-scene callers; `replaceObjectInScene` no longer delegates to it.

- [ ] **Step 4: Update `clearStaleSelection` to reset `selectedSceneId`.** Replace its body:

```ts
export function clearStaleSelection(
  history: History<Project>,
  editPath: string[],
  selectedSceneId: string | null,
  ids: string[],
): { selectedObjectIds: string[]; selectedObjectId: string | null; selectedSceneId: string | null } {
  const present = history.present;
  const scenes = present.scenes;
  // A restore (undo of promote/scene-delete) may leave selectedSceneId naming a gone scene.
  const nextSceneId = scenes
    ? scenes.some((sc) => sc.id === selectedSceneId)
      ? selectedSceneId
      : scenes[0]?.id ?? null
    : null;
  const scope: SceneScope = { sceneId: nextSceneId, assetId: editPath.at(-1) ?? null };
  const objects = sceneObjectsOf(present, scope);
  const live = ids.filter((id) => objects.some((o) => o.id === id));
  return { selectedObjectIds: live, selectedObjectId: live.at(-1) ?? null, selectedSceneId: nextSceneId };
}
```

- [ ] **Step 5: Update store.ts call sites.** In `store.ts`:
  - `commitActiveScene`: `get().commit(withSceneObjects(s.history.present, selectActiveScope(s), nextObjects));` (import `selectActiveScope` from `./selectors`).
  - `undo`/`redo`: `set({ history, ...clearStaleSelection(history, get().editPath, get().selectedSceneId, get().selectedObjectIds) });`
  - Replace **every** `replaceObjectInScene(project, selectActiveAssetId(s), …)` and `appendToScene(project, selectActiveAssetId(s), …)` / `appendObjectToScene(…, selectActiveAssetId(s), …)` / `sceneObjectsOf(…, selectActiveAssetId(s))` with `selectActiveScope(s)` in place of `selectActiveAssetId(s)`. (Mechanical; `grep -n "selectActiveAssetId(s)" src/ui/store/store.ts` lists them — each one feeding a write helper changes to `selectActiveScope(s)`. Bare reads of `selectActiveAssetId(s)` not feeding these helpers may stay, but converting them to `selectActiveScope(s).assetId` is harmless. Prefer converting all feeding-a-write-helper sites.)

- [ ] **Step 6: Run tests, verify pass + parity.** Run: `pnpm test store-internals && pnpm test store` — Expected: PASS. Run `pnpm test` — Expected: 1646 still green (single-scene parity: `scope.sceneId` is null, `scope.assetId` unchanged, so every helper takes the root/symbol branch exactly as before).

- [ ] **Step 7: Typecheck + commit.**

```bash
pnpm typecheck && pnpm lint
git add src/ui/store/store-internals.ts src/ui/store/store-internals.test.ts src/ui/store/store.ts
git commit -m "feat(8b-3): scene-aware write helpers (SceneScope) + clearStaleSelection scene reset"
```

---

## Task 3: Route direct `project.objects` readers in store.ts

**Files:**
- Modify: `src/ui/store/store.ts` (`addObject` ~147-160, `duplicateSelected` ~161-202, `setPrimitiveParam` ~680, `drawOn` ~873)
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `selectActiveObjects`, `selectActiveScope` (Tasks 1-2), `commitActiveScene`, `nextZOrder`, `appendToScene`/`withSceneObjects`.

- [ ] **Step 1: Write failing routing tests.** In `store.test.ts` add a `describe('multi-scene editing routes to the selected scene')`:

```ts
import { promoteToMultiScene } from '../../engine/scenes';
// helper: set up a 2-scene project with scene 2 selected
function twoSceneSelected() {
  const e = useEditor.getState();
  e.setProject(promoteToMultiScene(createProject())); // scene 0 = empty root
  useEditor.getState().addScene();                    // creates + selects scene 1 (index 1)
}

it('addObject appends to the selected scene, not project.objects', () => {
  twoSceneSelected();
  const someAsset = /* add a rect asset id via the same path other addObject tests use */;
  useEditor.getState().addObject(someAsset);
  const p = useEditor.getState().history.present;
  expect(p.objects).toEqual([]);                       // root stays empty
  const sel = useEditor.getState().selectedSceneId!;
  expect(p.scenes!.find((sc) => sc.id === sel)!.objects.length).toBe(1);
  expect(p.scenes![0].objects.length).toBe(0);         // scene 0 untouched
});
```

(Use whatever asset-creation path the existing `addObject` tests use — match the file's existing setup helpers; do not invent a new asset API.)

- [ ] **Step 2: Run, verify fail.** Run: `pnpm test store` — Expected: FAIL (object lands in `project.objects`, scene stays empty).

- [ ] **Step 3: Route `addObject`.** Replace the body's reads/commit:

```ts
addObject(assetId) {
  const s = get();
  const project = s.history.present;
  const asset = project.assets.find((a) => a.id === assetId);
  const anchorX = asset && asset.kind === 'svg' ? asset.width / 2 : 0;
  const anchorY = asset && asset.kind === 'svg' ? asset.height / 2 : 0;
  const active = selectActiveObjects(s);
  const obj = createSceneObject(assetId, {
    name: `${asset?.name ?? 'Object'} ${nextZOrder(active) + 1}`,
    zOrder: nextZOrder(active),
    anchorX,
    anchorY,
  });
  get().commitActiveScene([...active, obj]);
  set({ selectedObjectId: obj.id, selectedObjectIds: [obj.id], selectedKeyframe: null });
},
```

- [ ] **Step 4: Route `duplicateSelected`.** Read the active scene's objects once and commit through `withSceneObjects`:

```ts
duplicateSelected() {
  const s = get();
  let objects = selectActiveObjects(s);
  const scope = selectActiveScope(s);
  let assets = s.history.present.assets;
  const dupLockById = new Map(objects.map((o) => [o.id, o]));
  const byId = new Map(objects.map((o) => [o.id, o] as const));
  const ids = new Set<string>();
  const addWithDescendants = (id: string) => {
    if (ids.has(id)) return;
    const o = byId.get(id);
    if (!o || isLockedInTree(o, dupLockById)) return;
    ids.add(id);
    for (const c of objects) if (c.parentId === id) addWithDescendants(c.id);
  };
  for (const id of s.selectedObjectIds) addWithDescendants(id);
  const sources = [...ids].map((id) => byId.get(id)!);
  if (sources.length === 0) return;
  const idMap = new Map<string, string>();
  for (const o of sources) idMap.set(o.id, newId());
  const cloneIds: string[] = [];
  for (const obj of sources) {
    const asset = assets.find((a) => a.id === obj.assetId);
    const isRoot = !obj.parentId || !idMap.has(obj.parentId);
    const newParentId = obj.parentId && idMap.has(obj.parentId) ? idMap.get(obj.parentId) : undefined;
    const { object, clonedAsset } = duplicateObject(obj, asset, { objectId: idMap.get(obj.id)!, assetId: newId() }, isRoot ? DUP_OFFSET : 0);
    const withParent = newParentId !== undefined ? { ...object, parentId: newParentId } : object;
    const placed = { ...withParent, zOrder: nextZOrder(objects) };
    if (clonedAsset) assets = [...assets, clonedAsset];
    objects = [...objects, placed];
    if (isRoot) cloneIds.push(placed.id);
  }
  get().commit(withSceneObjects({ ...s.history.present, assets }, scope, objects));
  get().selectObjects(cloneIds);
},
```

- [ ] **Step 5: Route `setPrimitiveParam` (~680) and `drawOn` (~873).** For each: change the lookup `project.objects.find(...)` → `selectActiveObjects(s).find(...)`, and any commit that builds `{ ...project, objects: project.objects.map(...) }` → `replaceObjectInScene(project, selectActiveScope(s), next)` (single-object change) or `commitActiveScene(nextObjects)` (whole-array change). Read each function body first; preserve its other logic verbatim. (These already partly use `selectActiveObjects`/`selectActiveScope` per the grep in Task 2 — finish the ones that still read `project.objects` directly.)

- [ ] **Step 6: Run, verify pass + parity.** Run: `pnpm test store` — Expected: PASS. Run `pnpm test` — Expected: 1646 green (single-scene: `selectActiveObjects` returns `present.objects` and `commitActiveScene`/`withSceneObjects` write the root, identical to before).

- [ ] **Step 7: Typecheck + commit.**

```bash
pnpm typecheck && pnpm lint
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(8b-3): route addObject/duplicateSelected/setPrimitiveParam/drawOn to the active scene"
```

---

## Task 4: Scene store actions + edit-duration scoping

**Files:**
- Create: `src/ui/store/slices/scenesSlice.ts`
- Modify: `src/engine/scenes.ts` (add `demoteToSingleScene`)
- Modify: `src/ui/store/store-internals.ts` (add the 6 action signatures to the actions interface)
- Modify: `src/ui/store/store.ts` (spread the scenes slice into the store)
- Modify: `src/ui/store/selectors.ts` (`selectEditDuration`)
- Modify: `src/ui/store/slices/transportPrefsSlice.ts` (`seek`/`stepFrame` use `selectEditDuration`)
- Modify: `src/ui/playback/usePlayback.ts` (loop length = `selectEditDuration`)
- Test: `src/engine/scenes.test.ts`, `src/ui/store/scenes.test.ts` (create), `src/ui/store/slices/transportPrefsSlice.test.ts` (or wherever seek is tested)

**Interfaces:**
- Produces (engine): `demoteToSingleScene(project): Project` — inverse of `promoteToMultiScene`; when exactly one scene remains, folds it back to root (`objects`/`camera` restored, `scenes` removed); otherwise returns `project` unchanged.
- Produces (store actions): `addScene(): void`, `deleteScene(sceneId: string): void`, `reorderScene(sceneId: string, toIndex: number): void`, `renameScene(sceneId: string, name: string): void`, `setSceneDuration(sceneId: string, duration: number): void`, `selectScene(sceneId: string): void`.
- Produces (selector): `selectEditDuration(s): number` — multi-scene: the selected scene's `duration`; single-scene: `computeProjectDuration(present)`.

- [ ] **Step 1: Write failing engine test for `demoteToSingleScene`.** In `scenes.test.ts`:

```ts
import { demoteToSingleScene, promoteToMultiScene, ROOT_SCENE_ID } from './scenes';
import { createProject, createSceneObject } from '.';

it('demoteToSingleScene folds a single remaining scene back to root (inverse of promote)', () => {
  const p0 = { ...createProject(), objects: [createSceneObject('a')] };
  const promoted = promoteToMultiScene(p0);
  const demoted = demoteToSingleScene(promoted);
  expect(demoted.scenes).toBeUndefined();
  expect(demoted.objects).toBe(promoted.scenes![0].objects);
  expect(demoted.camera).toBe(promoted.scenes![0].camera);
});

it('demoteToSingleScene is a no-op with 2+ scenes or already single-scene', () => {
  const p = createProject();
  expect(demoteToSingleScene(p)).toBe(p);
  const two = { ...promoteToMultiScene(p), scenes: [{ id: ROOT_SCENE_ID, name: 'A', objects: [], duration: 1 }, { id: 'x', name: 'B', objects: [], duration: 1 }] };
  expect(demoteToSingleScene(two)).toBe(two);
});
```

- [ ] **Step 2: Implement `demoteToSingleScene` in `engine/scenes.ts`.**

```ts
/** Inverse of promoteToMultiScene: when EXACTLY ONE scene remains, fold it back to the root
 *  (objects/camera restored, `scenes` removed) so the project returns to byte-parity single-scene
 *  form. No-op for 0/2+ scenes or an already single-scene project. */
export function demoteToSingleScene(project: Project): Project {
  if (!project.scenes || project.scenes.length !== 1) return project;
  const only = project.scenes[0];
  const next: Project = { ...project, objects: only.objects, camera: only.camera };
  delete (next as { scenes?: Scene[] }).scenes;
  return next;
}
```

- [ ] **Step 3: Run, verify pass.** Run: `pnpm test scenes` — Expected: PASS.

- [ ] **Step 4: Write failing store-action tests.** In `src/ui/store/scenes.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditor } from './store';
import { createProject } from '../../engine';

beforeEach(() => useEditor.getState().setProject(createProject()));

it('addScene promotes a single-scene project and selects the new scene', () => {
  const e = useEditor.getState();
  e.addScene();
  const p = useEditor.getState().history.present;
  expect(p.scenes).toBeDefined();
  expect(p.scenes!.length).toBe(2);                 // scene 0 (promoted root) + new
  expect(p.objects).toEqual([]);
  expect(useEditor.getState().selectedSceneId).toBe(p.scenes![1].id);
  expect(useEditor.getState().time).toBe(0);
});

it('deleteScene removes a scene; deleting down to one demotes back to single-scene', () => {
  const e = useEditor.getState();
  e.addScene();                                      // now 2 scenes
  const second = useEditor.getState().history.present.scenes![1].id;
  e.deleteScene(second);
  expect(useEditor.getState().history.present.scenes).toBeUndefined(); // demoted
});

it('reorderScene moves a scene to a new index', () => {
  const e = useEditor.getState();
  e.addScene();
  const p0 = useEditor.getState().history.present;
  const [a, b] = p0.scenes!.map((s) => s.id);
  e.reorderScene(b, 0);
  expect(useEditor.getState().history.present.scenes!.map((s) => s.id)).toEqual([b, a]);
});

it('renameScene / setSceneDuration update the scene; duration clamps to > 0', () => {
  const e = useEditor.getState();
  e.addScene();
  const id = useEditor.getState().history.present.scenes![1].id;
  e.renameScene(id, 'Intro');
  e.setSceneDuration(id, 0);                          // clamped
  const sc = useEditor.getState().history.present.scenes!.find((s) => s.id === id)!;
  expect(sc.name).toBe('Intro');
  expect(sc.duration).toBeGreaterThan(0);
});

it('selectScene switches selection, clears object selection and exits any symbol', () => {
  const e = useEditor.getState();
  e.addScene();
  const first = useEditor.getState().history.present.scenes![0].id;
  e.selectScene(first);
  expect(useEditor.getState().selectedSceneId).toBe(first);
  expect(useEditor.getState().selectedObjectIds).toEqual([]);
  expect(useEditor.getState().editPath).toEqual([]);
  expect(useEditor.getState().time).toBe(0);
});
```

- [ ] **Step 5: Run, verify fail.** Run: `pnpm test scenes` — Expected: FAIL (`addScene` undefined).

- [ ] **Step 6: Implement `scenesSlice.ts`.** Follow the `transportPrefsSlice.ts` slice shape (a factory taking `(set, get)` and returning the action object; the action-name keys are added to the actions union in `store-internals.ts`).

```ts
import { promoteToMultiScene, demoteToSingleScene, computeProjectDuration, newId } from '../../../engine';
import type { Scene } from '../../../engine';
import type { EditorState } from '../store-internals';
import { selectActiveSceneId } from '../selectors';

const MIN_SCENE_DURATION = 1 / 240; // > 0; one quarter-frame at 60fps. Real floor is content/manual.

type SceneActions = 'addScene' | 'deleteScene' | 'reorderScene' | 'renameScene' | 'setSceneDuration' | 'selectScene';

export function createScenesSlice(
  set: (partial: Partial<EditorState>) => void,
  get: () => EditorState,
): Pick<EditorState, SceneActions> {
  const commitScenes = (scenes: Scene[]) => {
    const present = get().history.present;
    const base = present.scenes ? present : promoteToMultiScene(present);
    get().commit({ ...base, objects: [], camera: undefined, scenes });
  };
  return {
    addScene() {
      const s = get();
      const promoted = s.history.present.scenes ? s.history.present : promoteToMultiScene(s.history.present);
      const scenes = promoted.scenes!;
      const activeIdx = scenes.findIndex((sc) => sc.id === selectActiveSceneId(s));
      const insertAt = (activeIdx >= 0 ? activeIdx : scenes.length - 1) + 1;
      const scene: Scene = { id: newId(), name: `Scene ${scenes.length + 1}`, objects: [], duration: 1 };
      const next = [...scenes.slice(0, insertAt), scene, ...scenes.slice(insertAt)];
      get().commit({ ...promoted, objects: [], camera: undefined, scenes: next });
      set({ selectedSceneId: scene.id, selectedObjectId: null, selectedObjectIds: [], editPath: [], time: 0 });
    },
    deleteScene(sceneId) {
      const present = get().history.present;
      if (!present.scenes || present.scenes.length <= 1) return; // never delete the last scene
      const next = present.scenes.filter((sc) => sc.id !== sceneId);
      const demoted = next.length === 1 ? demoteToSingleScene({ ...present, scenes: next }) : { ...present, scenes: next };
      get().commit(demoted);
      const nextSel = demoted.scenes ? (demoted.scenes.find((sc) => sc.id === get().selectedSceneId)?.id ?? demoted.scenes[0].id) : null;
      set({ selectedSceneId: nextSel, selectedObjectId: null, selectedObjectIds: [], editPath: [], time: 0 });
    },
    reorderScene(sceneId, toIndex) {
      const present = get().history.present;
      if (!present.scenes) return;
      const from = present.scenes.findIndex((sc) => sc.id === sceneId);
      if (from < 0) return;
      const clamped = Math.max(0, Math.min(toIndex, present.scenes.length - 1));
      const next = [...present.scenes];
      const [moved] = next.splice(from, 1);
      next.splice(clamped, 0, moved);
      get().commit({ ...present, scenes: next });
    },
    renameScene(sceneId, name) {
      const present = get().history.present;
      if (!present.scenes) return;
      get().commit({ ...present, scenes: present.scenes.map((sc) => (sc.id === sceneId ? { ...sc, name } : sc)) });
    },
    setSceneDuration(sceneId, duration) {
      const present = get().history.present;
      if (!present.scenes) return;
      const d = Math.max(MIN_SCENE_DURATION, duration);
      get().commit({ ...present, scenes: present.scenes.map((sc) => (sc.id === sceneId ? { ...sc, duration: d } : sc)) });
    },
    selectScene(sceneId) {
      if (!get().history.present.scenes?.some((sc) => sc.id === sceneId)) return;
      set({ selectedSceneId: sceneId, selectedObjectId: null, selectedObjectIds: [], editPath: [], time: 0 });
    },
  };
}
```

(`commitScenes` is unused above — drop it; keep the explicit per-action commits. Remove the dead helper before commit.) Add `addScene`/`deleteScene`/`reorderScene`/`renameScene`/`setSceneDuration`/`selectScene` to the actions interface in `store-internals.ts` with the signatures from the Interfaces block. Spread `...createScenesSlice(set, get)` into the store object in `store.ts` (next to the transport slice spread).

- [ ] **Step 7: Implement `selectEditDuration` + scope transport/playback.** In `selectors.ts`:

```ts
import { computeProjectDuration } from '../../engine';

/** The duration the editor transport/playback span: the SELECTED scene's duration in multi-scene
 *  (per-scene local time model), else the single-scene project duration. */
export function selectEditDuration(s: EditorState): number {
  const present = s.history.present;
  if (present.scenes) {
    const id = selectActiveSceneId(s);
    return present.scenes.find((sc) => sc.id === id)?.duration ?? 0;
  }
  return computeProjectDuration(present);
}
```

In `transportPrefsSlice.ts` `seek` and `stepFrame`, replace `computeProjectDuration(get().history.present)` with `selectEditDuration(get())` (import it). In `usePlayback.ts:49`, replace `const duration = computeProjectDuration(project);` with the selected-scene duration: read it from the store — `const duration = selectEditDuration(useEditor.getState());` (or pass via the existing project subscription if the hook already has full state). Keep loop/clamp semantics otherwise unchanged.

- [ ] **Step 8: Update `TransportControls.tsx`.** Change `const duration = useEditor((s) => computeProjectDuration(s.history.present));` to `const duration = useEditor((s) => selectEditDuration(s));` so the readout shows the active scene's length.

- [ ] **Step 9: Run, verify pass + parity.** Run: `pnpm test scenes && pnpm test transport && pnpm test usePlayback` — Expected: PASS. Run `pnpm test` — Expected: green (single-scene: `selectEditDuration` == `computeProjectDuration`, parity).

- [ ] **Step 10: Typecheck + commit.**

```bash
pnpm typecheck && pnpm lint
git add src/engine/scenes.ts src/engine/scenes.test.ts src/ui/store/slices/scenesSlice.ts src/ui/store/scenes.test.ts src/ui/store/store-internals.ts src/ui/store/store.ts src/ui/store/selectors.ts src/ui/store/slices/transportPrefsSlice.ts src/ui/playback/usePlayback.ts src/ui/components/TransportControls/TransportControls.tsx
git commit -m "feat(8b-3): scene store actions (add/delete/reorder/rename/duration/select) + per-scene edit duration"
```

---

## Task 5: Stage focused-project scene-view fix

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx` (the line ~70 `project` memo)
- Test: covered by Task 7 e2e + an optional unit on the memo inputs; the imperative handlers already use `selectEditProject` (fixed in Task 1).

**Interfaces:**
- Consumes: `selectActiveObjects`, `selectActiveSceneCamera` (Tasks 1).

- [ ] **Step 1: Update the render-frame project memo.** Stage currently builds `project = activeObjects === present.objects ? present : { ...present, objects: activeObjects }`. In multi-scene this keeps `present.scenes` (set) and `present.camera` (undefined) → the frame painter would re-enter the multi-scene/master path. Subscribe to the scene camera and strip scenes:

```ts
const present = useEditor((s) => s.history.present);
const activeObjects = useEditor((s) => selectActiveObjects(s));
const sceneCamera = useEditor((s) => selectActiveSceneCamera(s));
const project = useMemo(
  () => (activeObjects === present.objects ? present : { ...present, objects: activeObjects, camera: sceneCamera, scenes: undefined }),
  [present, activeObjects, sceneCamera],
);
```

Add `selectActiveSceneCamera` to the `selectors` import. This matches `selectEditProject` exactly so the reactive painter and the imperative handlers agree.

- [ ] **Step 2: Verify single-scene parity.** Run `pnpm test` — Expected: green. (`activeObjects === present.objects` short-circuits to the same `present` ref in single-scene; the new branch only runs for a focused sub-scene where `present.scenes` is already undefined for symbols and the camera equals `present.camera`.)

- [ ] **Step 3: Manual smoke (optional, gated by Task 6).** Defer visual confirmation to Task 7's e2e once the SceneStrip exists.

- [ ] **Step 4: Typecheck + commit.**

```bash
pnpm typecheck && pnpm lint
git add src/ui/components/Stage/Stage.tsx
git commit -m "fix(8b-3): Stage render project uses scene-view (camera + scenes:undefined) in multi-scene"
```

---

## Task 6: SceneStrip UI + scene thumbnail

**Files:**
- Create: `src/ui/components/AssetPanel/thumbnailSvg.ts` — add `sceneThumbnailSvg` (same file as `symbolThumbnailSvg`)
- Create: `src/ui/components/SceneStrip/SceneStrip.tsx`
- Create: `src/ui/components/SceneStrip/SceneStrip.module.css`
- Modify: `src/ui/App.tsx` (mount in the timeline section)
- Test: `src/ui/components/SceneStrip/SceneStrip.test.tsx`

**Interfaces:**
- Consumes: `projectScenes` (engine), `selectActiveSceneId`, store actions from Task 4, `sceneThumbnailSvg`.
- Produces: `sceneThumbnailSvg(scene: Scene, assets: Asset[], meta: ProjectMeta): string` — an SVG string of the scene at t=0 over the project artboard viewBox.

- [ ] **Step 1: Add `sceneThumbnailSvg`.** Mirror `symbolThumbnailSvg`, but a scene shares the project artboard and its objects render via the single-scene path (a scene-view project):

```ts
import type { Scene } from '../../../engine';

/** SVG markup for a scene's thumbnail at t=0, framed to the project artboard. The scene renders
 *  through the single-scene renderer (scene-view: objects swapped, no nested scenes). */
export function sceneThumbnailSvg(scene: Scene, assets: Asset[], meta: ProjectMeta): string {
  const project: Project = { meta, assets, objects: scene.objects, audioClips: [], camera: scene.camera };
  return renderSvgDocument(project, { viewBox: `0 0 ${meta.width} ${meta.height}` });
}
```

(Add `Scene` to the type imports. `renderSvgDocument` is already imported in this file for `symbolThumbnailSvg`.)

- [ ] **Step 2: Write failing SceneStrip test.** In `SceneStrip.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SceneStrip } from './SceneStrip';
import { useEditor } from '../../store/store';
import { createProject } from '../../../engine';

beforeEach(() => useEditor.getState().setProject(createProject()));

describe('SceneStrip', () => {
  it('shows one scene for a single-scene project and an add button', () => {
    render(<SceneStrip />);
    expect(screen.getAllByRole('button', { name: /scene/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /add scene/i })).toBeInTheDocument();
  });

  it('add scene creates and selects a second scene', () => {
    render(<SceneStrip />);
    fireEvent.click(screen.getByRole('button', { name: /add scene/i }));
    expect(useEditor.getState().history.present.scenes!.length).toBe(2);
  });

  it('clicking a scene selects it', () => {
    useEditor.getState().addScene();
    render(<SceneStrip />);
    const first = useEditor.getState().history.present.scenes![0].id;
    fireEvent.click(screen.getByTestId(`scene-${first}`));
    expect(useEditor.getState().selectedSceneId).toBe(first);
  });
});
```

- [ ] **Step 3: Run, verify fail.** Run: `pnpm test SceneStrip` — Expected: FAIL (component missing).

- [ ] **Step 4: Implement `SceneStrip.tsx`.** A horizontal filmstrip reading `projectScenes(present)` (works single + multi). Each tile: thumbnail (`sceneThumbnailSvg` via `dangerouslySetInnerHTML` on a sized box, like the AssetPanel symbol thumbnails), name (double-click → inline rename input → `renameScene`), duration number input (`setSceneDuration`), delete button (hidden when only one scene), draggable for reorder (`reorderScene` on drop). A trailing "Add scene" button (`addScene`). Highlight the active tile via `selectActiveSceneId`.

```tsx
import { useMemo, useState } from 'react';
import { projectScenes } from '../../../engine';
import { useEditor } from '../../store/store';
import { selectActiveSceneId } from '../../store/selectors';
import { sceneThumbnailSvg } from '../AssetPanel/thumbnailSvg';
import styles from './SceneStrip.module.css';

export function SceneStrip() {
  const present = useEditor((s) => s.history.present);
  const activeSceneId = useEditor((s) => selectActiveSceneId(s));
  const { addScene, deleteScene, reorderScene, renameScene, setSceneDuration, selectScene } = useEditor.getState();
  const scenes = useMemo(() => projectScenes(present), [present]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  return (
    <div className={styles.strip} role="list" aria-label="Scenes">
      {scenes.map((scene, index) => {
        const active = scene.id === activeSceneId || (!present.scenes && index === 0);
        return (
          <div
            key={scene.id}
            role="listitem"
            className={`${styles.tile} ${active ? styles.active : ''}`}
            draggable
            onDragStart={() => setDragId(scene.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragId) reorderScene(dragId, index); setDragId(null); }}
          >
            <button
              type="button"
              data-testid={`scene-${scene.id}`}
              aria-label={`Scene ${scene.name}`}
              className={styles.thumb}
              onClick={() => selectScene(scene.id)}
              dangerouslySetInnerHTML={{ __html: sceneThumbnailSvg(scene, present.assets, present.meta) }}
            />
            {editingId === scene.id ? (
              <input
                autoFocus
                className={styles.name}
                defaultValue={scene.name}
                aria-label="Scene name"
                onBlur={(e) => { renameScene(scene.id, e.target.value || scene.name); setEditingId(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              />
            ) : (
              <span className={styles.name} onDoubleClick={() => setEditingId(scene.id)}>{scene.name}</span>
            )}
            <input
              type="number"
              min={0}
              step={0.1}
              className={styles.duration}
              aria-label="Scene duration"
              value={scene.duration}
              onChange={(e) => setSceneDuration(scene.id, Number(e.target.value))}
            />
            {scenes.length > 1 && (
              <button type="button" aria-label={`Delete ${scene.name}`} className={styles.del} onClick={() => deleteScene(scene.id)}>×</button>
            )}
          </div>
        );
      })}
      <button type="button" aria-label="Add scene" className={styles.add} onClick={() => addScene()}>+</button>
    </div>
  );
}
```

Note: single-scene shows the synthesized `ROOT_SCENE_ID` tile (from `projectScenes`); its duration input edits a synthesized value — guard by hiding the duration input when `!present.scenes`, OR make `setSceneDuration` a no-op single-scene (it already early-returns `if (!present.scenes) return`). Hide the duration input and delete button when `!present.scenes` to avoid editing the synthesized projection.

- [ ] **Step 5: Implement `SceneStrip.module.css`.** A single-row flex container, horizontally scrollable, fixed tile width (~96px), thumbnail aspect = artboard. Match the visual language of the existing Timeline/AssetPanel CSS modules (read one for tokens/spacing). `.active { outline: 2px solid var(--accent); }`.

- [ ] **Step 6: Mount in `App.tsx`.** Inside `<section className={styles.timeline} aria-label="Timeline">`, render `<SceneStrip />` before `<Timeline />`. Import it.

- [ ] **Step 7: Run, verify pass.** Run: `pnpm test SceneStrip` — Expected: PASS. Run `pnpm test` — Expected: green.

- [ ] **Step 8: Typecheck + commit.**

```bash
pnpm typecheck && pnpm lint
git add src/ui/components/SceneStrip src/ui/components/AssetPanel/thumbnailSvg.ts src/ui/App.tsx
git commit -m "feat(8b-3): SceneStrip UI (thumbnails, add/select/reorder/rename/duration/delete)"
```

---

## Task 7: Multi-scene editor e2e

**Files:**
- Create: `e2e/scenes-editor.spec.ts`

**Interfaces:**
- Consumes: the full editor (dev server via the existing Playwright config).

- [ ] **Step 1: Write the e2e.** Mirror the structure of an existing spec (e.g. `e2e/symbols.spec.ts`). Scope all object/selector queries to `section[aria-label="Stage"]` — per the logged lesson, SceneStrip thumbnails emit `data-savig-object`, so bare `[data-savig-object]` selectors would collide with the strip's thumbnails and time out.

```ts
import { test, expect } from '@playwright/test';

test('multi-scene: add a scene, draw in it, switch scenes, routing is per-scene', async ({ page }) => {
  await page.goto('/');
  const stage = page.locator('section[aria-label="Stage"]');

  // 1. add a scene -> 2 tiles
  await page.getByRole('button', { name: 'Add scene' }).click();
  await expect(page.getByRole('list', { name: 'Scenes' }).getByRole('listitem')).toHaveCount(2);

  // 2. draw a rectangle in the (selected) 2nd scene
  // (reuse the project's existing "draw a rect" gesture from another spec)
  // ... draw ...
  await expect(stage.locator('[data-savig-object]')).toHaveCount(1);

  // 3. switch to scene 1 (empty) -> stage clears
  const tiles = page.getByRole('list', { name: 'Scenes' }).getByRole('listitem');
  await tiles.nth(0).getByRole('button', { name: /^Scene/ }).click();
  await expect(stage.locator('[data-savig-object]')).toHaveCount(0);

  // 4. switch back to scene 2 -> rect returns
  await tiles.nth(1).getByRole('button', { name: /^Scene/ }).click();
  await expect(stage.locator('[data-savig-object]')).toHaveCount(1);

  // 5. rename + set duration persist
  await tiles.nth(1).getByLabel('Scene name').dblclick().catch(() => {});
});
```

(Fill the draw gesture from the existing spec that already draws a shape; do not invent a new gesture. Keep assertions on counts within `stage`.)

- [ ] **Step 2: Kill any stale vite, run e2e.** Run: `pkill -f vite; pnpm e2e scenes-editor` — Expected: PASS.

- [ ] **Step 3: Run the full e2e suite to confirm no regressions.** Run: `pnpm e2e` — Expected: all green (prior specs unaffected; single-scene UI unchanged).

- [ ] **Step 4: Commit.**

```bash
git add e2e/scenes-editor.spec.ts
git commit -m "test(8b-3): multi-scene editor e2e (add/select/draw routing per scene)"
```

---

## Self-Review Notes (spec §10 coverage)

- **`selectedSceneId` separate axis (not editPath):** Task 1 (state) + two-axis `selectActiveObjects`.
- **Two-layer resolution (scene base → symbol descent):** Task 1/2 — symbol axis wins in `selectActiveObjects`/`writeSceneObjects`; scene base governs the root.
- **One scene always selected in multi-scene:** `selectActiveSceneId` defaults to `scenes[0]`.
- **Stale-selection clearing on undo (M-fix):** Task 2 `clearStaleSelection` resets `selectedSceneId`.
- **Scene strip (add/delete/reorder/rename/select/duration):** Task 6.
- **Promote on adding the 2nd scene:** Task 4 `addScene`. **Demote on deleting to one:** Task 4 `deleteScene` + `demoteToSingleScene`.
- **Timeline scopes to active scene local time:** Tasks 1/3 (`selectActiveObjects` feeds Timeline) + Task 4 (`selectEditDuration` bounds transport/playback/seek).
- **Stage preview per scene (preview == export per scene):** Task 5 scene-view memo.
- **Align/distribute/center already route through `commitActiveScene`:** Task 2 makes `commitActiveScene` scene-aware — no per-action change needed (verify in Task 2 step 6).
- **Direct `project.objects` readers re-audited:** Task 3.
- **Deferred to 8b-4 (explicit):** master-timeline scrub across scenes; transition picker in the strip; cross-scene onion skin. The strip's duration field and audio lane on the master timeline (rec. 7) are noted but the audio lane stays unchanged (global) for this slice.

**Decision recorded:** Time model = **per-scene local** (mirrors in-symbol editing); master scrub deferred to 8b-4. `s.time` is local to the selected scene; transport/playback bounded to `selectEditDuration`.
