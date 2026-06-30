# M5 Slice 8b-2a — Extract `renderSceneBody` (export, parity-safe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Refactor the monolithic `renderSvgDocument` into a reusable per-scene body/defs renderer `renderSceneBody(project, sceneId)` that, when given a `sceneId`, scene-namespaces every per-leaf id — without changing single-scene export output by a single byte.

**Architecture:** `renderSceneBody(project, sceneId: string | null)` returns `{ body, assetDefs, localDefs }`. It is today's `renderSvgDocument` internals, with two additions gated on `sceneId !== null`: (1) prefix each leaf's `renderId`/`clipId`/`tintId` with `` `${sceneId}:` `` immediately after `flattenInstances` (so all downstream id derivations inherit it and match the runtime's `computeFrame` objectIds), and (2) disable the static-symbol `<use>` optimization (it is asset-keyed and root-scoped — handled by full inlining in multi-scene). `renderSvgDocument(project, opts)` becomes a thin wrapper: `renderSceneBody(project, null)` + the existing camera wrap + `<svg>` assembly, **byte-identical** to today.

**Tech Stack:** TypeScript strict, Vitest (`pnpm test`). No deps. No runtime/bundle change (that's 8b-2c).

## Global Constraints

- **PARITY (the whole point):** `renderSvgDocument(project, opts)` output MUST be byte-identical to before. The ~1300-line golden suite `src/services/export/renderDocument.test.ts` is the gate — it must stay green with **zero** test edits.
- **Scene prefix:** when `sceneId !== null`, prefix exactly `leaf.renderId`, `leaf.clipId` (if set), `leaf.tintId` (if set) with `` `${sceneId}:` ``. Do NOT prefix asset-keyed ids (`savig-asset-${assetId}`, `savig-sym-${assetId}`) — they derive from `assetId`, not `renderId`, and stay global.
- **Static-symbol `<use>` optimization** is DISABLED when `sceneId !== null` (full inlining instead). Single-scene (`sceneId === null`) keeps it (parity).
- **Defs assembly order** (must match today exactly): `${assetDefs}${staticSymDefs(sorted)}${clipPathDefs}${tintFilterDefs}${gradientDefs}`.
- Do NOT modify `flattenInstances`, `renderShapeToSvg` (its `idScope` param already takes `leaf.renderId`), or any engine file. This is export-layer only.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/services/export/renderDocument.ts` | extract `renderSceneBody`; `renderSvgDocument` becomes a wrapper | Modify |
| `src/services/export/renderDocument.test.ts` | new scene-prefix tests (existing goldens unchanged) | Modify |

---

## Task 1: Failing tests — `renderSceneBody` scene prefixing + parity intent

**Files:** Modify `src/services/export/renderDocument.test.ts`

**Interfaces:**
- Produces (Task 2): `export function renderSceneBody(project: Project, sceneId: string | null): { body: string; assetDefs: Map<string, string>; localDefs: string }`.

- [ ] **Step 1: Write the failing tests.** Append (match the file's existing imports/factories; add `renderSceneBody` to the `./renderDocument` import):

```ts
describe('renderSceneBody — scene id prefixing (8b-2a)', () => {
  it('prefixes data-savig-object and gradient def ids with "<sceneId>:" when sceneId is set', () => {
    // a rect with an animated/explicit fill gradient (exercises the gradient-id derivation)
    const asset = createVectorAsset('rect', { id: 'rectA' });
    asset.style.fillGradient = { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, stops: [
      { offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' } ] };
    const obj = createSceneObject('rectA', { id: 'r1' });
    const project = { ...createProject(), assets: [asset], objects: [obj] };

    const { body, localDefs } = renderSceneBody(project, 'sc1');
    expect(body).toContain('data-savig-object="sc1:r1"');
    expect(localDefs).toContain('savig-grad-sc1:r1-fill'); // matches runtime computeFrame objectId "sc1:r1"
    expect(body).toContain('url(#savig-grad-sc1:r1-fill)');
  });

  it('sceneId=null leaves ids unprefixed (parity path)', () => {
    const asset = createVectorAsset('rect', { id: 'rectA' });
    const obj = createSceneObject('rectA', { id: 'r1' });
    const project = { ...createProject(), assets: [asset], objects: [obj] };
    const { body } = renderSceneBody(project, null);
    expect(body).toContain('data-savig-object="r1"');
    expect(body).not.toContain(':r1"');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/services/export/renderDocument.test.ts`
Expected: FAIL — `renderSceneBody` is not exported.

- [ ] **Step 3: Commit failing tests**

```bash
git add src/services/export/renderDocument.test.ts
git commit -m "test(8b-2a): failing renderSceneBody scene-prefix tests"
```

---

## Task 2: Extract `renderSceneBody`; make `renderSvgDocument` a wrapper

**Files:** Modify `src/services/export/renderDocument.ts`

**Interfaces:**
- Produces: `export function renderSceneBody(project, sceneId: string | null): { body: string; assetDefs: Map<string, string>; localDefs: string }`.
- `renderSvgDocument(project, opts?)` keeps its signature; output byte-identical.

- [ ] **Step 1: Create `renderSceneBody`** by moving the CURRENT body of `renderSvgDocument` (lines ~27–164, everything from `const assetsById = …` down to the `staticDefsHtml` computation) into a new exported function `renderSceneBody(project: Project, sceneId: string | null)`, with these exact changes:

  1. After `const leaves = flattenInstances(project, 0);`, insert the prefixing step:
  ```ts
  // Scene-namespace every per-leaf id so two scenes' generated ids never collide in the shared
  // <defs>, AND so exported data-savig-object / gradient def ids match the runtime's computeFrame
  // objectId ("<sceneId>:<renderId>"). Asset-keyed defs (savig-asset/savig-sym) derive from assetId,
  // not renderId, so they stay global (unprefixed). sceneId===null (single-scene) => no change.
  const scoped = sceneId === null ? leaves : leaves.map((l) => ({
    ...l,
    renderId: `${sceneId}:${l.renderId}`,
    ...(l.clipId ? { clipId: `${sceneId}:${l.clipId}` } : {}),
    ...(l.tintId ? { tintId: `${sceneId}:${l.tintId}` } : {}),
  }));
  ```
  Then use `scoped` everywhere the function currently uses `leaves` (the `usedSvgIds` computation, `buildClipPathDefs(scoped)`, and the `while (i < scoped.length)` body loop).

  2. Disable the static-symbol optimization for scenes (the file already declares the value type `StaticInstanceInfo`):
  ```ts
  const staticOptimizable = sceneId === null
    ? buildStaticOptimizableMap(project, assetsById)
    : new Map<string, StaticInstanceInfo>();
  ```
  The `staticInfo` lookups then always miss for scenes → full inlining, unchanged code path. (If the value type has a different name in the file, use that exact name — confirm by reading `buildStaticOptimizableMap`'s return type.)

  3. Change `defs` from a joined string to a Map for global dedup by the caller:
  ```ts
  // assetDefs: assetId -> <symbol> def. Built in usedSvgIds (sorted) order so the single-scene
  // join is byte-identical to today's `defs`. The multi-scene caller (8b-2b) dedups across scenes.
  const assetDefs = new Map<string, string>();
  for (const assetId of usedSvgIds) assetDefs.set(assetId, defineSymbol(assetsById.get(assetId) as SvgAsset));
  ```

  4. Return the pieces (do NOT build the `<svg>`/camera here):
  ```ts
  const localDefs = `${staticDefsHtml}${clipPathDefs}${tintFilterDefs.join('')}${gradientDefs.join('')}`;
  return { body: bodyParts.join(''), assetDefs, localDefs };
  ```

- [ ] **Step 2: Rewrite `renderSvgDocument` as a thin wrapper:**

```ts
export function renderSvgDocument(project: Project, opts?: { viewBox?: string }): string {
  const { body, assetDefs, localDefs } = renderSceneBody(project, null);
  const defs = Array.from(assetDefs.values()).join('');
  const viewBox = opts?.viewBox ?? `0 0 ${fmt(project.meta.width)} ${fmt(project.meta.height)}`;
  // Single-scene camera wrap (slice 8a) — unchanged. Absent camera => no wrapper (parity).
  const cameraTransform = computeCameraTransform(project, 0);
  const wrapped = cameraTransform !== null
    ? `<g data-savig-camera transform="${cameraTransform}">${body}</g>`
    : body;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">` +
    `<defs>${defs}${localDefs}</defs>${wrapped}</svg>`
  );
}
```

This reproduces today's exact string: `defs` == old `defs` (svg-asset), `localDefs` == old `${staticDefsHtml}${clipPathDefs}${tintFilterDefs}${gradientDefs}`, same camera wrap, same `<svg>` shell.

- [ ] **Step 3: Run the export golden suite (the parity gate)**

Run: `pnpm test src/services/export/renderDocument.test.ts`
Expected: PASS — ALL existing goldens green (byte-identical single-scene output) PLUS the new scene-prefix tests. If any golden fails, the extraction drifted from the exact assembly order/content — fix `renderSceneBody`/`renderSvgDocument` to restore byte-identity; do NOT edit the golden.

- [ ] **Step 4: Full suite + typecheck + lint**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS (export consumers — `core/render.ts`, `exportProject` — unaffected; they call `renderSvgDocument`, whose output is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/services/export/renderDocument.ts
git commit -m "refactor(8b-2a): extract renderSceneBody; renderSvgDocument wraps it (parity)"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** implements the 8b-2 §7 "per-scene id salt" via the chosen leaf-prefix approach (memory `savig-m5-progress`), and the asset-keyed-def exemption (C2) falls out for free (those derive from `assetId`). Single-scene parity is the gate.
- **Placeholder scan:** none — the extraction is described as exact transformations of named lines; the one type-shaped instruction (empty-map type for `staticOptimizable`) is bounded.
- **Type consistency:** `renderSceneBody` return shape `{ body: string; assetDefs: Map<string,string>; localDefs: string }` is consumed identically by `renderSvgDocument` (Task 2) and by 8b-2b's `renderProjectDocument`.
- **Risk:** the only parity risk is the defs-assembly order; mitigated by the explicit `${defs}${localDefs}` reconstruction matching the documented original order, gated by the golden suite.
