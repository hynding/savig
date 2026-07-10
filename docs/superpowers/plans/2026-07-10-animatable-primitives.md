# Animatable Polygon/Star Parameters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keyframable `sides`/`starPoints`/`innerRatio`/`primitiveRotation` (+ reused `cornerRadius`) on stamped polygon/star primitives, regenerating the path per frame.

**Architecture:** Param keyframes ride the generic `obj.tracks` (new `AnimatableProperty` members — timeline rows, keyframe ops, DSL/MCP, duration all inherit them). `sampleObject` gains an optional `primitive?: PrimitiveSpec` param and regenerates `state.path` via `primitivePathFromSpec` when any primitive track exists and no `shapeTrack` (morph wins). Consumers (runtime `computeFrame`, static export, Stage, anchor resolution) pass the asset's spec.

**Tech Stack:** pnpm monorepo, TS strict, Vitest colocated, Playwright e2e at repo-root `e2e/`.

**Spec:** `docs/superpowers/specs/2026-07-10-animatable-primitives-design.md` (approved). File:line references below come from a verified seam survey; treat them as anchors and re-locate by pattern if drifted.

## Global Constraints

- **Parity:** with NO primitive-param track, `state.path` stays unset and every render is byte-identical to before.
- Priority chain: `obj.boolean` (consumer layer) > `shapeTrack` (morph) > primitive regeneration.
- Sampled-value hygiene at regeneration: `sides` = `Math.max(3, Math.round(v))`, `starPoints` = `Math.max(2, Math.round(v))`, `innerRatio` clamped [0.01, 0.99], `cornerRadius` ≥ 0. `primitiveRotation` track is DEGREES; convert `(v * Math.PI) / 180` onto `spec.rotation` (radians).
- **Any commit touching `packages/engine/src/sample.ts`, `packages/engine/src/primitives.ts`, or `packages/runtime/src/**` MUST regenerate the runtime bundle in the SAME commit:** `(cd packages/runtime && node scripts/build-runtime.mjs)` (script path — verify via `packages/runtime/package.json` `build:runtime`) and `git add packages/runtime/src/runtimeSource.generated.ts`.
- Store ops route through `selectActiveObjects`/`selectActiveScope`; autoKey keyframes preserve an existing keyframe's easing (dash/trim precedent).
- Test gotcha: fresh `useEditor.getState()` per read.
- Env: `node_modules/.bin/{vitest,tsc,eslint,playwright}` from repo root; NEVER `pnpm install`/`pnpm approve-builds`; revert stray `pnpm-workspace.yaml` changes after e2e runs.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Engine — property members + `sampleObject` regeneration

**Files:**
- Modify: `packages/engine/src/types.ts` (`AnimatableProperty` union, :32-39)
- Modify: `packages/engine/src/project.ts` (new `PRIMITIVE_PROPERTIES` const next to `GEOMETRY_PROPERTIES`, :15-30)
- Modify: `packages/engine/src/sample.ts` (`sampleObject` signature + third resolution step, after the shapeTrack block at :62-64)
- Modify: `packages/engine/src/primitives.ts` (`roundCorners` docstring amendment, :16-19)
- Modify: `packages/runtime/src/runtimeSource.generated.ts` (regenerated — see Global Constraints)
- Test: `packages/engine/src/sample.test.ts`, `packages/engine/src/duration.test.ts` (append)

**Interfaces:**
- Produces: `AnimatableProperty` gains `'sides' | 'starPoints' | 'innerRatio' | 'primitiveRotation'`; `export const PRIMITIVE_PROPERTIES = ['sides', 'starPoints', 'innerRatio', 'primitiveRotation'] as const;` (project.ts); `sampleObject(obj: SceneObject, time: number, primitive?: PrimitiveSpec): RenderState` — regenerates `state.path` per the spec's Decision 3. Tasks 2–5 rely on these exact names.

- [ ] **Step 1: Write failing tests** — append to `sample.test.ts` (reuse its fixtures; a primitive spec literal is `{ kind: 'star', cx: 50, cy: 50, radius: 40, rotation: 0, points: 5, innerRatio: 0.5, cornerRadius: 0 }`):

```
1. No primitive tracks + primitive passed → state.path undefined (parity).
2. starPoints track [t0:5 → t1:9] + spec passed → state.path at t0 has 10 nodes (5 points × 2)
   and at t1 has 18; at the midpoint the interpolated 7 → Math.round → 14 nodes.
3. innerRatio interpolating below 0.01 clamps (path equals the 0.01 regeneration, compare via
   primitivePathFromSpec({...spec, innerRatio: 0.01})).
4. primitiveRotation track value 90 (degrees) regenerates with spec.rotation = Math.PI/2
   (compare against primitivePathFromSpec with that rotation).
5. cornerRadius track > 0 regenerates a rounded path (node count changes vs cornerRadius 0 —
   roundCorners emits handle nodes).
6. shapeTrack wins: object with BOTH shapeTrack and a sides track → state.path equals the
   sampled shapeTrack path, not a regeneration.
7. sides track on a spec of kind 'star' is ignored for regeneration params it doesn't own —
   actually: 'sides' only applies to kind 'polygon'; for a star spec a sides track must NOT
   trigger regeneration by itself nor alter the star (assert path equals parity/base case).
   Symmetrically starPoints/innerRatio on a polygon spec.
```

Append to `duration.test.ts`: an object whose `tracks.starPoints` last keyframe is at 6.5s →
`objectsMaxKeyframeTime` = 6.5 (pins the generic loop covering the new member — should pass
immediately once the type admits the key; that is acceptable, note it in the report).

- [ ] **Step 2: Run to verify failure**

Run: `node_modules/.bin/vitest run packages/engine/src/sample.test.ts`
Expected: FAIL (regeneration missing; type errors for the new property names are part of the RED).

- [ ] **Step 3: Implement** — types.ts:

```ts
export type AnimatableProperty =
  | 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity'
  | GeometryProperty
  | PrimitiveProperty;

/** Parametric-primitive params (slice: animatable primitives). Keyframes live in the generic
 *  obj.tracks; sampling regenerates the path from the asset's PrimitiveSpec per frame. */
export type PrimitiveProperty = 'sides' | 'starPoints' | 'innerRatio' | 'primitiveRotation';
```

project.ts (next to `GEOMETRY_PROPERTIES`):

```ts
export const PRIMITIVE_PROPERTIES: readonly PrimitiveProperty[] = [
  'sides', 'starPoints', 'innerRatio', 'primitiveRotation',
];
```

sample.ts — signature `export function sampleObject(obj: SceneObject, time: number, primitive?: PrimitiveSpec): RenderState` and, AFTER the shapeTrack block (so morph wins by order):

```ts
  else if (primitive) {
    // Animatable primitive params: any non-empty primitive-param track (incl. cornerRadius)
    // regenerates the path from the spec with sampled overrides. No track at all -> no
    // regeneration (parity: state.path stays unset and the baked asset.path renders).
    const trackVal = (prop: AnimatableProperty): number | undefined => {
      const track = obj.tracks[prop];
      return track && track.length > 0 ? interpolate(track, time) : undefined;
    };
    const sides = trackVal('sides');
    const starPoints = trackVal('starPoints');
    const innerRatio = trackVal('innerRatio');
    const primRot = trackVal('primitiveRotation');
    const corner = trackVal('cornerRadius');
    const relevant =
      primitive.kind === 'polygon'
        ? [sides, primRot, corner]
        : [starPoints, innerRatio, primRot, corner];
    if (relevant.some((v) => v !== undefined)) {
      state.path = primitivePathFromSpec({
        ...primitive,
        ...(primitive.kind === 'polygon' && sides !== undefined
          ? { sides: Math.max(3, Math.round(sides)) }
          : {}),
        ...(primitive.kind === 'star' && starPoints !== undefined
          ? { points: Math.max(2, Math.round(starPoints)) }
          : {}),
        ...(primitive.kind === 'star' && innerRatio !== undefined
          ? { innerRatio: Math.min(0.99, Math.max(0.01, innerRatio)) }
          : {}),
        ...(primRot !== undefined ? { rotation: (primRot * Math.PI) / 180 } : {}),
        ...(corner !== undefined ? { cornerRadius: Math.max(0, corner) } : {}),
      });
    }
  }
```

Attach as `else if` to the existing `if (obj.shapeTrack && ...)` block. Import `primitivePathFromSpec` from `./primitives` and `PrimitiveSpec`/`PrimitiveProperty` types. NOTE: `cornerRadius` alone must trigger regeneration only when a spec is present (it is — this branch requires `primitive`); the kind-mismatch rule (test 7) is enforced by the `relevant` list: a lone `sides` track on a star contributes nothing to `relevant`.

primitives.ts docstring (:16-19): replace the "The runtime never calls this" sentence with: "Called at authoring time AND by per-frame primitive regeneration in sampleObject (animatable primitives), so this file is part of the runtime bundle."

- [ ] **Step 4: Regenerate the runtime bundle**

Run: `(cd packages/runtime && node scripts/build-runtime.mjs)` (adjust path per package.json `build:runtime`), then confirm `git status` shows `runtimeSource.generated.ts` modified.

- [ ] **Step 5: Run tests to verify pass**

Run: `node_modules/.bin/vitest run packages/engine && node_modules/.bin/tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/types.ts packages/engine/src/project.ts packages/engine/src/sample.ts packages/engine/src/primitives.ts packages/engine/src/sample.test.ts packages/engine/src/duration.test.ts packages/runtime/src/runtimeSource.generated.ts
git commit -m "feat(engine): animatable primitive params — per-frame path regeneration in sampleObject"
```

---

### Task 2: Consumers — runtime, static export, Stage, anchor resolution

**Files:**
- Modify: `packages/runtime/src/frame.ts` (`computeFrameForScene`'s `sampleObject` call, :64)
- Modify: `packages/services/src/export/renderDocument.ts` (`renderLeaf`'s `sampleObject` call and its `framePath` chain, ~:449-454)
- Modify: `apps/react/src/ui/components/Stage/Stage.tsx` (the `sampledObj = sampleObject(...)` call AND `renderOneleaf`'s `d` computation ~:1090-1098 — unify it to consume `sampledObj.path` for the non-boolean case instead of re-sampling shapeTrack inline)
- Modify: `packages/interaction/src/snapping.ts` (`resolveObjectAnchor` :132-137 — pass the asset's primitive so selection chrome/bbox follows the animated shape)
- Modify: `packages/runtime/src/runtimeSource.generated.ts` (regenerate — frame.ts changed)
- Test: runtime frame test file (append), `apps/react/src/ui/components/Stage/Stage.test.tsx` (append)

**Interfaces:**
- Consumes: `sampleObject(obj, time, primitive?)` (Task 1).
- Produces: all four consumers pass `asset.kind === 'vector' ? asset.primitive : undefined` (each site already holds or can look up the asset — frame.ts has `assetsById`, renderDocument has `asset`, Stage has `asset`, snapping has `project`).

- [ ] **Step 1: Write failing tests** — runtime test: project with a star + `starPoints` track [0s:5 → 1s:9] → `computeFrame(project, 0)` item.pathD ≠ `computeFrame(project, 1)` item.pathD, and node counts differ (count path commands in the `d` string, e.g. occurrences of `C`/`L`); without tracks pathD is absent (parity — item has no pathD for a static primitive since state.path is unset). Stage test: a star with a `starPoints` track renders a `d` at the current playhead that differs after `seek()` to the second keyframe (fresh getState + rerender per the file's conventions).

- [ ] **Step 2: Run to verify failure** — `node_modules/.bin/vitest run packages/runtime apps/react/src/ui/components/Stage`. Expected: FAIL.

- [ ] **Step 3: Implement** — each call site gains the third arg. frame.ts (`:64` — `asset` is looked up at :65, MOVE the lookup above the sample call):

```ts
      const asset = assetsById.get(obj.assetId);
      const state = sampleObject(obj, leaf.localTime, asset?.kind === 'vector' ? asset.primitive : undefined);
```

renderDocument.ts: same pattern at its `sampleObject` call (asset already in scope; if the call precedes the asset lookup, reorder). Stage.tsx: same at the `sampledObj` call; then in `renderOneleaf`'s `d` computation, replace the inline `o.shapeTrack ... samplePath(...)` branch with `sampledObj.path ? pathToD(sampledObj.path) : <existing static asset.path branch>` — boolean branch stays first and untouched. snapping.ts `resolveObjectAnchor`: look up the asset from the `project` param (mirror how it resolves the asset for shapeType today — read the function first) and pass `asset.primitive`.

- [ ] **Step 4: Regenerate the runtime bundle** — `(cd packages/runtime && node scripts/build-runtime.mjs)`; confirm `runtimeSource.generated.ts` modified.

- [ ] **Step 5: Run tests + parity suites**

Run: `node_modules/.bin/vitest run packages/runtime packages/services apps/react packages/interaction && node_modules/.bin/tsc --noEmit`
Expected: PASS (existing morph/boolean/parity tests green — the renderOneleaf unification must not change morph rendering; if a morph test fails, the unification altered branch priority — fix the order, don't touch the test).

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/frame.ts packages/services/src/export/renderDocument.ts apps/react/src/ui/components/Stage packages/interaction/src/snapping.ts packages/runtime/src/runtimeSource.generated.ts <test files>
git commit -m "feat(runtime,services,app): thread primitive spec into sampling; Stage consumes sampled path"
```

---

### Task 3: Store — autoKey-aware `setPrimitiveParam` + rotation param + detach strip

**Files:**
- Modify: `packages/editor-state/src/store-internals.ts` (`setPrimitiveParam` signature :216-217 — widen param union with `'rotation'`)
- Modify: `packages/editor-state/src/store.ts` (`setPrimitiveParam` :767-787; `setPathData` detach :812-816)
- Create: `packages/editor-state/src/store.primitives.test.ts`

**Interfaces:**
- Consumes: `PRIMITIVE_PROPERTIES`, `PrimitiveProperty` (Task 1); existing helpers (`upsertKeyframe`, `createKeyframe`, `snapToFrame`, `KF_EPS`, `replaceObjectInScene`, `selectActiveObjects`, `selectActiveScope`) all already imported.
- Produces: `setPrimitiveParam(param: 'sides'|'points'|'innerRatio'|'cornerRadius'|'rotation', value: number): void` — autoKey ON → keyframe on the MAPPED track (`points`→`starPoints`, `rotation`→`primitiveRotation`, others same-named) at the frame-snapped playhead preserving existing easing; autoKey OFF → today's spec-overwrite (rotation writes `spec.rotation` in RADIANS from a degree input, matching Decision 5). Task 4's Inspector rotation row calls this.

- [ ] **Step 1: Write failing tests** — `store.primitives.test.ts` (fixture: `addPrimitive({kind:'star', cx:50, cy:50, radius:40, rotation:0, points:5, innerRatio:0.5, cornerRadius:0})` — check addPrimitive's exact signature/id behavior in store.ts:736 first):

```
1. autoKey OFF: setPrimitiveParam('points', 7) → asset.primitive.points === 7 AND asset.path
   regenerated (today's behavior still intact); no obj.tracks entry.
2. autoKey ON: setPrimitiveParam('points', 7) at playhead t → obj.tracks.starPoints has a
   keyframe {time: snapped t, value: 7}; asset.primitive UNCHANGED; second call at same t with
   different value preserves the first keyframe's easing.
3. Mapping: 'rotation' → tracks.primitiveRotation (value stays in degrees on the track);
   autoKey OFF 'rotation' 90 → asset.primitive.rotation === Math.PI/2 and asset.path regenerated.
4. Kind guards: 'sides' on a star no-ops in BOTH modes; clamps applied in both modes
   (points ≥2 int, innerRatio [0.01,0.99], cornerRadius ≥0, sides ≥3 int).
5. Detach: node-edit via setPathData on the primitive → asset.primitive undefined AND
   obj.tracks no longer contains any of sides/starPoints/innerRatio/primitiveRotation/cornerRadius
   (other tracks, e.g. x, survive). One commit.
6. In-symbol scope: autoKey keyframe lands on the symbol's object (fresh getState()).
```

- [ ] **Step 2: Run to verify failure** — `node_modules/.bin/vitest run packages/editor-state/src/store.primitives.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — store.ts `setPrimitiveParam`: keep the existing lookup/kind-guard/clamp block, add the mapping + autoKey fork:

```ts
    const TRACK_OF = {
      sides: 'sides', points: 'starPoints', innerRatio: 'innerRatio',
      cornerRadius: 'cornerRadius', rotation: 'primitiveRotation',
    } as const;
    if (s.autoKey) {
      const prop = TRACK_OF[param];
      const time = snapToFrame(s.time, project.meta.fps);
      const existing = obj.tracks[prop] ?? [];
      const priorEasing = existing.find((k) => Math.abs(k.time - time) < KF_EPS)?.easing ?? 'linear';
      const next = upsertKeyframe(existing, createKeyframe(time, clamped, { easing: priorEasing }));
      get().commit(replaceObjectInScene(project, selectActiveScope(s), { ...obj, tracks: { ...obj.tracks, [prop]: next } }));
      return;
    }
    // autoKey OFF: existing spec-overwrite; for 'rotation' convert degrees -> radians:
    const specValue = param === 'rotation' ? (clamped * Math.PI) / 180 : clamped;
    const next: PrimitiveSpec = { ...asset.primitive, [param === 'rotation' ? 'rotation' : param]: specValue };
    // ...existing primitivePathFromSpec + assets.map + commit unchanged
```

(For the track, `clamped` for 'rotation' is the raw degree value — no clamp beyond finite; extend the clamp block with a `rotation` case that passes the value through.) `setPathData` detach (:812-816): alongside `primitive: undefined`, strip the tracks:

```ts
      const { sides, starPoints, innerRatio, primitiveRotation, cornerRadius, ...restTracks } = obj.tracks;
      // primitive detach: orphaned param tracks would silently inflate computeProjectDuration
```

and commit the object with `tracks: restTracks` in the same commit as the asset change (verify how setPathData currently commits — thread the object update through its existing single commit; if the destructure trips no-unused-vars for locals, use an omit helper like Task 1 of style-tools did — see `omitDashFields` in this file for the precedent). store-internals.ts: widen the param union with `'rotation'` and update the doc comment (autoKey duality).

- [ ] **Step 4: Run tests to verify pass** — `node_modules/.bin/vitest run packages/editor-state && node_modules/.bin/tsc --noEmit && node_modules/.bin/eslint .`. Expected: PASS/clean.

- [ ] **Step 5: Commit**

```bash
git add packages/editor-state/src/store-internals.ts packages/editor-state/src/store.ts packages/editor-state/src/store.primitives.test.ts
git commit -m "feat(editor-state): autoKey-aware primitive params + rotation param + detach strips tracks"
```

---

### Task 4: Inspector rotation row + VM/timeline pins

**Files:**
- Modify: `packages/ui-core/src/viewmodels/inspector.ts` (primitive VM :433-439 — add `rotation` in DEGREES, sampled-at-playhead: track value ?? `spec.rotation * 180/Math.PI`)
- Modify: `apps/react/src/ui/components/Inspector/Inspector.tsx` (Primitive section :592-608 — add the rotation NumberField, `aria-label="primitive rotation"`, committing `intents.setPrimitiveParam('rotation', n)`)
- Test: inspector VM test (append), `Inspector.test.tsx` (append), timeline VM test (append — pin that a `starPoints` track yields a scalar row automatically)

**Interfaces:**
- Consumes: `setPrimitiveParam('rotation', n)` (Task 3); sampled tracks via the VM's existing sampled state.
- Produces: Inspector primitive VM field `rotation: number` (degrees). E2E (Task 5) uses the existing `points` input's accessible name — check what the current inputs' aria-labels are (Inspector.tsx:592-608) and record them in your report for Task 5.

- [ ] **Step 1: Write failing tests** — VM: primitive star → `primitive.rotation` present (degrees; spec radians π/2 → 90); with a `primitiveRotation` track, the playhead-sampled value wins. Inspector component: rotation row renders for a primitive, commits through `setPrimitiveParam` (autoKey default ON → keyframe asserted). Timeline VM: object with `tracks.starPoints` → `scalarTracks` includes a `starPoints` row (should pass immediately — generic; note it).

- [ ] **Step 2: Run to verify failure** — `node_modules/.bin/vitest run packages/ui-core/src/viewmodels apps/react/src/ui/components/Inspector`. Expected: FAIL (except the timeline pin).

- [ ] **Step 3: Implement** — mirror the existing primitive VM rounding (`inspector.ts:433-439`) for rotation (convert spec radians → degrees, override with sampled track value when present — sampled scalar tracks are already resolved into the VM's `sampled` RenderState? NO — primitive props aren't in ANIMATABLE/GEOMETRY loops, so `sampled` does NOT carry them; read the track directly: `interpolate(obj.tracks.primitiveRotation, time)` when non-empty, mirroring how the VM reads `dashOffsetTrack` at :296). Inspector row mirrors the neighboring primitive rows' markup.

- [ ] **Step 4: Run to verify pass + commit**

Run: `node_modules/.bin/vitest run packages/ui-core apps/react && node_modules/.bin/tsc --noEmit`

```bash
git add packages/ui-core/src/viewmodels apps/react/src/ui/components/Inspector
git commit -m "feat(ui): primitive rotation row (degrees) + animated primitive VM values"
```

---

### Task 5: DSL/MCP pins + E2E + full gates

**Files:**
- Test: `packages/core/src/dsl.test.ts` (append: `animate: { starPoints: [...] }` compiles into tracks and round-trips), `packages/mcp/src/tools.test.ts` (append: `set_keyframe` with `property: 'starPoints'` lands on the track)
- Create: `e2e/animatable-primitives.spec.ts`

- [ ] **Step 1: DSL/MCP pin tests** — both should pass without code changes (generic machinery); write them, run `node_modules/.bin/vitest run packages/core packages/mcp`, and if either FAILS, stop and report the gap (that's a real finding, not a test problem).

- [ ] **Step 2: Write the e2e** — house style (Stage-scoped selectors; star tool button name per ToolPalette is "Star"; drag to stamp; primitive inputs' aria-labels from Task 4's report). Flow: stamp a star → Auto-key stays ON (default) → at t=0 set points=5 via the Inspector input → click ruler to move playhead (~120px) → set points=9 → read the stage `<path>`'s `d` at both ruler positions and assert they differ AND the later one is longer (more segments); assert a timeline row/diamond for the track exists (`data-testid` pattern for scalar keyframes — find how scalar diamonds are addressed in Timeline.tsx and use that).

- [ ] **Step 3: Run e2e** — `pkill -f vite || true; node_modules/.bin/playwright test e2e/animatable-primitives.spec.ts`. Expected: PASS. Debug gestures against the real app; never weaken assertions.

- [ ] **Step 4: Full gates** — `node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run && node_modules/.bin/eslint . && node_modules/.bin/playwright test` (full suite, includes `@portable`). Check/revert stray `pnpm-workspace.yaml`. Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/dsl.test.ts packages/mcp/src/tools.test.ts e2e/animatable-primitives.spec.ts
git commit -m "test: DSL/MCP pins for primitive tracks + animatable-primitives e2e"
```

---

## Out of scope (per spec)

Animating cx/cy/radius; stamping defaults; morph into/out of primitives; per-vertex easing.
