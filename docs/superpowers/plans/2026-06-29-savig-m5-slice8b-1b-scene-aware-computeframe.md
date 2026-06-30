# M5 Slice 8b-1b — Scene-aware `computeFrame` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `computeFrame(project, t)` render the active scene at master time `t` (with scene-namespaced object ids) when `project.scenes` is present, while staying byte-identical for single-scene projects.

**Architecture:** Extract the current `computeFrame` body into `computeFrameForScene(sceneProject, localTime, sceneId)`; `computeFrame` becomes a thin dispatcher. **Key design choice (refines spec §6):** instead of the spec's suggested `flattenObjects(objects, assets)` extraction, we pass a **scene-scoped `Project` view** (`{ ...project, objects: scene.objects, scenes: undefined }`) to the *unchanged* `flattenInstances` **and** `resolveBooleanRings`. This is strictly more complete than the extraction option: `resolveBooleanRings` (called inside `computeFrame`) also resolves its operands from `project.objects` (`geom/boolean.ts:413,433` + `parentGroupOf(project.objects,…)`), so a boolean object *inside a scene* would break under the objects-only extraction but works correctly with the view. `flattenInstances` and `resolveBooleanRings` are NOT modified.

**Tech Stack:** TypeScript (strict), Vitest (`pnpm test` = `vitest run`). No new dependencies. No runtime-bundle regeneration (single-scene behavior is unchanged; the multi-scene runtime + `pnpm build:runtime` is slice 8b-2).

## Global Constraints

- **Parity discipline:** when `project.scenes` is `undefined`, `computeFrame(project, t)` output MUST be byte-identical to before this slice — same `objectId`s (no prefix), same transforms, same every `FrameItem` field. The acceptance test is a promote-and-strip equality (Task 1).
- **Scene id prefix:** in multi-scene mode every `FrameItem.objectId` is `` `${sceneId}:${leaf.renderId}` ``. The `:` separator is fixed. Single-scene ⇒ no prefix.
- **Cut only:** `sceneAtTime` returns no `outgoing` in this milestone, so `computeFrame` renders only the primary scene. Do NOT add `outgoing`/transition handling — that is slice 8b-4.
- **Do NOT modify** `flattenInstances` (`src/engine/symbol.ts`) or `resolveBooleanRings` (`src/engine/geom/boolean.ts`). The scene-view passes them the active scene with zero signature change.
- **Do NOT regenerate** `src/runtime/runtimeSource.generated.ts` (no freshness check exists; single-scene runtime behavior is identical; multi-scene runtime is 8b-2).
- **Factory helpers** (from `src/engine/project.ts`, already imported by `frame.test.ts`): `createProject`, `createSceneObject(assetId, overrides?)`, `createVectorAsset(shapeType, overrides?)` — **`shapeType` is required, use `'rect'`/`'path'`**, `createSymbolAsset(overrides?)`, `createKeyframe(time, value)`. Engine helpers `projectScenes`, `promoteToMultiScene`, `sceneAtTime`, `ROOT_SCENE_ID` are exported from `../engine` (added in 8b-1a).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/runtime/frame.ts` | `computeFrameForScene` (extracted body) + scene-aware `computeFrame` dispatcher | Modify |
| `src/runtime/frame.test.ts` | Parity goldens, scene-prefix tests, boolean-in-scene test | Modify |

---

## Task 1: Failing tests — parity, scene-prefix, boolean-in-scene

**Files:**
- Modify: `src/runtime/frame.test.ts`

**Interfaces:**
- Consumes (to be produced by Task 2): `computeFrame(project, t)` becomes scene-aware; `computeFrameForScene(sceneProject: Project, localTime: number, sceneId: string | null): FrameItem[]` is exported from `src/runtime/frame.ts`.
- These tests assert the *behavior* Task 2 implements; they fail against current code because today's `computeFrame` ignores `project.scenes` and reads `project.objects` (empty in a promoted multi-scene project) → returns `[]`.

- [ ] **Step 1: Write the failing tests** — append to `src/runtime/frame.test.ts`. The file already imports `computeFrame` from `./frame` and `createProject`/`createSceneObject`/`createVectorAsset`/`createSymbolAsset`/`createKeyframe`/`type Project` from `../engine`, and uses `it` (not `test`). ADD `promoteToMultiScene, ROOT_SCENE_ID` to the existing `../engine` import. (All test blocks below use `it` to match the file.)

```ts
// add to the existing `from '../engine'` import: promoteToMultiScene, ROOT_SCENE_ID

// Strip the leading "<sceneId>:" namespace from a multi-scene frame's object ids, so a
// promoted project's frame can be compared to the original single-scene frame.
function stripScenePrefix(items: ReturnType<typeof computeFrame>, sceneId: string) {
  return items.map((it) => ({ ...it, objectId: it.objectId.replace(new RegExp(`^${sceneId}:`), '') }));
}

// A representative single-scene project exercising the FrameItem surface:
// a rect with an animated geometry track + a symbol instance (transformPrefix path).
function richSingleScene() {
  const rectAsset = createVectorAsset('rect', { id: 'rectA' });
  const rect = createSceneObject('rectA', { id: 'r1', zOrder: 0 });
  rect.base = { ...rect.base, x: 50, y: 60 };
  rect.tracks = { x: [createKeyframe(0, 50), createKeyframe(2, 200)] };

  const innerAsset = createVectorAsset('rect', { id: 'innerRect' });
  const inner = createSceneObject('innerRect', { id: 'in1', zOrder: 0 });
  const sym = createSymbolAsset({ id: 'symA', objects: [inner] });
  const instance = createSceneObject('symA', { id: 'inst1', zOrder: 1 });
  instance.base = { ...instance.base, x: 120, y: 40 };

  return { ...createProject(), assets: [rectAsset, innerAsset, sym], objects: [rect, instance] };
}

describe('computeFrame — single-scene parity under promotion (8b-1b)', () => {
  it('promoted multi-scene frame, prefix stripped, equals the single-scene frame', () => {
    const original = richSingleScene();
    const promoted = promoteToMultiScene(original); // scenes[0] wraps the same objects, id ROOT_SCENE_ID
    for (const t of [0, 1, 2]) {
      const single = computeFrame(original, t);
      const multi = stripScenePrefix(computeFrame(promoted, t), ROOT_SCENE_ID);
      expect(multi).toEqual(single);
    }
  });

  it('a project with no scenes is unchanged: object ids carry no prefix', () => {
    const original = richSingleScene();
    const ids = computeFrame(original, 0).map((it) => it.objectId);
    expect(ids).toContain('r1');
    expect(ids.some((id) => id.includes(':'))).toBe(false);
  });
});

describe('computeFrame — multi-scene active-scene selection (8b-1b)', () => {
  it('renders only the active scene, with scene-prefixed object ids', () => {
    const aAsset = createVectorAsset('rect', { id: 'aRect' });
    const bAsset = createVectorAsset('rect', { id: 'bRect' });
    const project = {
      ...createProject(),
      assets: [aAsset, bAsset],
      objects: [],
      scenes: [
        { id: 'sceneA', name: 'A', objects: [createSceneObject('aRect', { id: 'oa' })], duration: 2 },
        { id: 'sceneB', name: 'B', objects: [createSceneObject('bRect', { id: 'ob' })], duration: 2 },
      ],
    };
    // t in [0,2): scene A active
    const aIds = computeFrame(project, 0.5).map((it) => it.objectId);
    expect(aIds).toEqual(['sceneA:oa']);
    // t in [2,4): scene B active
    const bIds = computeFrame(project, 2.5).map((it) => it.objectId);
    expect(bIds).toEqual(['sceneB:ob']);
  });
});

describe('computeFrame — boolean operand resolution inside a scene (8b-1b)', () => {
  it('a boolean object whose operands live in the same scene resolves (non-empty pathD)', () => {
    // Two overlapping rect paths unioned by a boolean object, all inside scene 0.
    // PathNode = { anchor: PathPoint; in?: PathPoint; out?: PathPoint } — corner nodes omit in/out.
    const p1 = createVectorAsset('path', { id: 'p1', path: { nodes: [
      { anchor: { x: 0, y: 0 } }, { anchor: { x: 40, y: 0 } },
      { anchor: { x: 40, y: 40 } }, { anchor: { x: 0, y: 40 } },
    ], closed: true } });
    const p2 = createVectorAsset('path', { id: 'p2', path: { nodes: [
      { anchor: { x: 20, y: 20 } }, { anchor: { x: 60, y: 20 } },
      { anchor: { x: 60, y: 60 } }, { anchor: { x: 20, y: 60 } },
    ], closed: true } });
    const o1 = createSceneObject('p1', { id: 'o1', zOrder: 0 });
    const o2 = createSceneObject('p2', { id: 'o2', zOrder: 1 });
    const boolObj = createSceneObject('p1', { id: 'u', zOrder: 2 });
    boolObj.boolean = { op: 'union', operandIds: ['o1', 'o2'] };

    const project = {
      ...createProject(),
      assets: [p1, p2],
      objects: [],
      scenes: [{ id: 's0', name: 'S0', objects: [o1, o2, boolObj], duration: 1 }],
    };
    const items = computeFrame(project, 0);
    const boolItem = items.find((it) => it.objectId === 's0:u');
    expect(boolItem).toBeDefined();
    expect(boolItem!.pathD).toBeTruthy();        // operands were found in the scene → real union path
    expect(boolItem!.pathD).not.toBe('');         // not the "fewer than two operands" empty result
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/runtime/frame.test.ts`
Expected: FAIL — the parity/multi-scene tests fail (promoted/multi-scene `computeFrame` currently returns `[]` because it reads the empty root `project.objects`); `computeFrameForScene` is not exported.

- [ ] **Step 3: Commit the failing tests**

```bash
git add src/runtime/frame.test.ts
git commit -m "test(8b-1b): failing parity + scene-prefix + boolean-in-scene tests"
```

---

## Task 2: Extract `computeFrameForScene` + scene-aware `computeFrame`

**Files:**
- Modify: `src/runtime/frame.ts`

**Interfaces:**
- Produces: `export function computeFrameForScene(sceneProject: Project, localTime: number, sceneId: string | null): FrameItem[]` — the *current* `computeFrame` body verbatim, with two changes: the time parameter is named `localTime`, and `objectId` is `` sceneId ? `${sceneId}:${leaf.renderId}` : leaf.renderId ``.
- Modifies: `computeFrame(project, time)` → dispatcher (below). `flattenInstances`/`resolveBooleanRings` calls inside `computeFrameForScene` receive `sceneProject` (the scene-scoped view), unchanged otherwise.

- [ ] **Step 1: Add `sceneAtTime` to the engine import** — in `src/runtime/frame.ts`, add `sceneAtTime` to the existing `from '../engine'` import list (it already imports many engine symbols).

- [ ] **Step 2: Rename the current `computeFrame` to `computeFrameForScene` and apply the two changes.** Replace the existing function signature line:

```ts
export function computeFrame(project: Project, time: number): FrameItem[] {
```

with:

```ts
// Compute the frame for ONE scene's object list at `localTime`. `sceneProject` is a Project whose
// `.objects` is the scene's scene-graph (for single-scene this is the project itself). When `sceneId`
// is non-null (multi-scene), every objectId is namespaced `"<sceneId>:<renderId>"` so the runtime
// node-map keys never collide across scenes; null ⇒ no prefix ⇒ byte-identical single-scene output.
export function computeFrameForScene(sceneProject: Project, localTime: number, sceneId: string | null): FrameItem[] {
```

Then, inside the body, update the references that used `project`/`time` to use `sceneProject`/`localTime`:
- `flattenInstances(project, time)` → `flattenInstances(sceneProject, localTime)`
- `const assetsById = new Map(project.assets...)` → `new Map(sceneProject.assets...)`
- `resolveBooleanRings(project, obj, leaf.localTime)` → `resolveBooleanRings(sceneProject, obj, leaf.localTime)`
- the `objectId: leaf.renderId,` line → `objectId: sceneId ? \`${sceneId}:${leaf.renderId}\` : leaf.renderId,`

(Leave every other line — sampling, geometry, gradients, dash, the `hasFillGradient`/`hasStrokeGradient` guards — exactly as it was. `leaf.localTime` references stay `leaf.localTime`.)

- [ ] **Step 3: Add the new `computeFrame` dispatcher** — directly ABOVE `computeFrameForScene`, add:

```ts
// Single definition of "sampled state -> SVG attributes", shared by the editor Stage and the export
// runtime (the parity test locks them to identical output). Multi-scene (8b): render the ACTIVE
// scene at master time `time` via a scene-scoped Project view, with scene-namespaced object ids.
// Single-scene (`scenes` absent): byte-identical to before — no view, no prefix.
export function computeFrame(project: Project, time: number): FrameItem[] {
  if (!project.scenes) return computeFrameForScene(project, time, null);
  const { primary } = sceneAtTime(project, time);
  // Scene-scoped view: the active scene's objects become `.objects` so flattenInstances AND
  // resolveBooleanRings (both read root `.objects`) operate on the scene. `scenes: undefined` so the
  // view is treated as single-scene. (8b-4 will also render `outgoing` during a transition.)
  const sceneView: Project = { ...project, objects: primary.scene.objects, scenes: undefined };
  return computeFrameForScene(sceneView, primary.localTime, primary.scene.id);
}
```

- [ ] **Step 4: Run the task's tests to verify they pass**

Run: `pnpm test src/runtime/frame.test.ts`
Expected: PASS — parity (promote-and-strip), scene-prefix, active-scene selection, and boolean-in-scene all green.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/frame.ts
git commit -m "feat(8b-1b): scene-aware computeFrame via computeFrameForScene + scene-view"
```

---

## Task 3: Full-suite parity verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `pnpm test`
Expected: PASS — all prior tests (incl. the export parity test that locks Stage==export==runtime, and `computeFrame`'s existing callers) plus the new 8b-1b tests. Any single-scene `computeFrame` consumer must be unaffected because `computeFrameForScene(project, time, null)` is the old body verbatim. If a pre-existing test fails, the extraction drifted — diff `computeFrameForScene` against the original body and restore exact equivalence (do not change the test).

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS for both.

- [ ] **Step 3: Confirm no out-of-scope changes**

Run: `git diff --stat main...HEAD`
Expected: only `src/runtime/frame.ts` and `src/runtime/frame.test.ts`. Specifically confirm `src/engine/symbol.ts` (flattenInstances), `src/engine/geom/boolean.ts` (resolveBooleanRings), and `src/runtime/runtimeSource.generated.ts` are UNCHANGED (the scene-view approach touches none of them, and the runtime bundle is regenerated in 8b-2, not here).

- [ ] **Step 4: Commit (only if Step 1 required a fixup)**

```bash
git add -A
git commit -m "test(8b-1b): restore exact single-scene parity in computeFrameForScene"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** 8b-1b's spec scope (`docs/superpowers/specs/2026-06-29-savig-m5-slice8b-multi-scene-sequencing-design.md` §6 + §16 row "8b-1b") — scene-aware `computeFrame` + scene-id prefix on `FrameItem.objectId`, parity goldens written first — all mapped (T1 goldens, T2 implementation). DEVIATION (documented in Architecture): the spec's `flattenObjects(objects, assets)` extraction is replaced by a scene-scoped `Project` view, because it is strictly more complete (`resolveBooleanRings` also reads root `.objects` and would otherwise break for booleans inside a scene). `flattenInstances` is left untouched. NOT in this slice (correctly deferred): export/runtime/raster + bundle regen (8b-2); transition `outgoing` rendering (8b-4).
- **Placeholder scan:** none — T1/T2 contain complete code. The two conditional instructions (confirm `PathNode` field names for the boolean test; restore parity if a pre-existing test drifts) are bounded verification steps, not deferred implementation.
- **Type consistency:** `computeFrameForScene(sceneProject: Project, localTime: number, sceneId: string | null): FrameItem[]` and the `computeFrame(project, time)` dispatcher signatures match between T2's definition and T1's consuming tests. `stripScenePrefix` uses `ROOT_SCENE_ID` (8b-1a export). The scene-view object literal matches `Project` (objects swapped, `scenes: undefined`).
- **Parity proof:** the acceptance test is `stripScenePrefix(computeFrame(promote(p), t)) deepEquals computeFrame(p, t)` for in-range `t` — this proves the multi-scene path reproduces the single-scene frame exactly modulo the id prefix, which is the precise contract. (Must use `t ≤ scene.duration`: `sceneAtTime` clamps `localTime` to the scene duration, so out-of-range `t` is a deliberately untested boundary here.)

## Additional recommendations (carry into downstream slices)

1. **8b-2 should reuse the scene-view pattern, NOT a `flattenObjects` extraction.** The same root-`.objects` trap that affects `resolveBooleanRings` also affects **export**: `renderSvgDocument` calls `flattenInstances(project, 0)` and `renderLeaf` resolves booleans against `project.objects`. When 8b-2 builds `renderProjectDocument`, it should render each scene by passing a scene-scoped `Project` view (`{ ...project, objects: scene.objects }`) to the existing per-scene renderer — mirroring this slice — rather than the spec §6/§16's `flattenObjects(objects, assets)` extraction. This keeps the whole multi-scene compute+render surface consistent and avoids re-introducing the boolean-operand bug in export. (The spec's §6 offered the extraction as one option; the scene-view is the chosen, more-complete one — record this when planning 8b-2.)
2. **The `:` separator is now load-bearing across slices.** 8b-2's runtime/export must build `data-savig-object="<sceneId>:<renderId>"` ids that match what `computeFrame` produces here, and the runtime node-map lookup must key on the same string. Keep the separator (`:`) and the `${sceneId}:${renderId}` shape identical in both producers; consider a tiny shared `sceneObjectId(sceneId, renderId)` helper in 8b-2 to prevent drift.
3. **`computeFrameForScene` is exported** so 8b-4 can call it for the `outgoing` scene during a transition without re-deriving the per-scene logic.
