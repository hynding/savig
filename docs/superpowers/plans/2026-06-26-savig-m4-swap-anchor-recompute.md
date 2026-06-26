# Recompute Instance Anchor on Swap-Symbol Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `swapSymbol` re-centres the instance anchor on the new symbol's content box and compensates
the translation (base + x/y keyframes) so the instance does not jump.

**Architecture:** Store-only change in `swapSymbol`; reuse the already-imported `sceneContentAABB`.
No engine/render change → parity untouched.

**Tech Stack:** TS strict, Zustand, Vitest.

## Global Constraints

- preview == export parity non-negotiable (preserved: store-only data edit).
- TS strict; no `any`. Reuse existing helpers (`sceneContentAABB`, `snapToFrame`).

---

### Task 1: `swapSymbol` anchor recompute + Δ-compensation

**Files:**
- Modify: `src/ui/store/store.ts` (`swapSymbol`, ~line 1553-1567).
- Test: `src/ui/store/store.test.ts`.

**Interfaces:**
- Consumes: `sceneContentAABB(objects, assets, time)` (imported at store.ts:60); `Keyframe { time, value, easing }`; `snapToFrame`.
- Produces: `swapSymbol` unchanged signature.

- [ ] **Step 1: Write the failing store tests**

Append to `src/ui/store/store.test.ts` a `describe('swapSymbol anchor recompute (47d)')`. Build two
symbols whose content centres differ. A symbol's content box = `sceneContentAABB` over its objects; a
10×10 rect leaf at base (0,0) gives centre (5,5); a 10×10 rect leaf at base (15,15) gives centre
(20,20). Pattern (mirror existing symbol-store tests; `createVectorAsset`/`createSceneObject`/`createSymbolAsset`/`createProject`):

```ts
describe('swapSymbol anchor recompute (47d)', () => {
  const rectLeaf = (id: string, x: number, y: number) => {
    const o = createSceneObject('rect-asset', { id, base: { x, y, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    o.shapeBase = { width: 10, height: 10 };
    return o;
  };
  const build = () => {
    const s = useEditor.getState();
    s.newProject();
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const symA = createSymbolAsset({ id: 'A', name: 'A', objects: [rectLeaf('la', 0, 0)], width: 10, height: 10 });   // centre (5,5)
    const symB = createSymbolAsset({ id: 'B', name: 'B', objects: [rectLeaf('lb', 15, 15)], width: 10, height: 10 }); // centre (20,20)
    const p = createProject();
    p.assets = [rectAsset, symA, symB];
    p.objects = [createSceneObject('A', { id: 'inst', anchorX: 5, anchorY: 5, base: { x: 100, y: 50, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } })];
    s.commit(p);
    return s;
  };
  const inst = () => useEditor.getState().history.present.objects.find((o) => o.id === 'inst')!;

  it('re-centres the anchor to the new content box and keeps the pivot world position fixed', () => {
    const s = build();
    s.swapSymbol('inst', 'B');
    const i = inst();
    expect(i.assetId).toBe('B');
    expect(i.anchorX).toBeCloseTo(20, 4);
    expect(i.anchorY).toBeCloseTo(20, 4);
    // pivot world = base + anchor is invariant: was 100+5=105, 50+5=55
    expect(i.base.x + i.anchorX).toBeCloseTo(105, 4);
    expect(i.base.y + i.anchorY).toBeCloseTo(55, 4);
  });

  it('shifts x/y track keyframes by the same delta', () => {
    const s = build();
    // give the instance an x track (absolute values) before swap
    const withTrack = useEditor.getState().history.present.objects.map((o) =>
      o.id === 'inst' ? { ...o, tracks: { ...o.tracks, x: [{ time: 0, value: 100, easing: 'linear' as const }, { time: 1, value: 200, easing: 'linear' as const }] } } : o);
    useEditor.getState().commit({ ...useEditor.getState().history.present, objects: withTrack });
    s.swapSymbol('inst', 'B');
    const i = inst();
    // delta dx = oldAnchorX(5) - newCentreX(20) = -15
    expect(i.tracks.x!.map((k) => k.value)).toEqual([85, 185]);
  });

  it('keeps the anchor when swapping to an empty symbol', () => {
    const s = build();
    const empty = createSymbolAsset({ id: 'E', name: 'E', objects: [], width: 0, height: 0 });
    useEditor.getState().commit({ ...useEditor.getState().history.present, assets: [...useEditor.getState().history.present.assets, empty] });
    s.swapSymbol('inst', 'E');
    const i = inst();
    expect(i.assetId).toBe('E');
    expect(i.anchorX).toBeCloseTo(5, 4); // unchanged — nothing to centre on
  });

  it('is undoable', () => {
    const s = build();
    s.swapSymbol('inst', 'B');
    s.undo();
    expect(inst().assetId).toBe('A');
    expect(inst().anchorX).toBeCloseTo(5, 4);
  });
});
```

NOTE before running: confirm `createSceneObject` accepts a `base` override and that `shapeBase` is the
right field for a rect leaf's size (the snapping.test.ts `instanceAABB` block uses exactly
`o.shapeBase = { width: 10, height: 10 }`). Confirm `Keyframe.easing` accepts `'linear'`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/store/store.test.ts -t "swapSymbol anchor"`
Expected: FAIL — anchor stays 5,5 (only assetId repointed today).

- [ ] **Step 3: Implement the recompute**

In `src/ui/store/store.ts`, replace the final commit line of `swapSymbol`
(`get().commitActiveScene(objects.map((o) => (o.id === instanceId ? { ...o, assetId: newSymId } : o)));`)
with the content-centre recompute + Δ-compensation:

```ts
    const time = snapToFrame(s.time, project.meta.fps);
    const box = sceneContentAABB(newSym.objects, project.assets, time);
    const repoint = (o: SceneObject): SceneObject => {
      if (!box) return { ...o, assetId: newSymId }; // empty new symbol: nothing to centre on — keep anchor
      const ax2 = (box.minX + box.maxX) / 2;
      const ay2 = (box.minY + box.maxY) / 2;
      const dx = o.anchorX - ax2;
      const dy = o.anchorY - ay2;
      const tracks = { ...o.tracks };
      if (tracks.x) tracks.x = tracks.x.map((k) => ({ ...k, value: k.value + dx }));
      if (tracks.y) tracks.y = tracks.y.map((k) => ({ ...k, value: k.value + dy }));
      return {
        ...o,
        assetId: newSymId,
        anchorX: ax2,
        anchorY: ay2,
        base: { ...o.base, x: o.base.x + dx, y: o.base.y + dy },
        tracks,
      };
    };
    get().commitActiveScene(objects.map((o) => (o.id === instanceId ? repoint(o) : o)));
```

Confirm `SceneObject` and `Keyframe` are imported in store.ts (most engine types already are; add to
the existing type import if missing — check the top-of-file import).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/ui/store/store.test.ts -t "swapSymbol"`
Expected: PASS (anchor + existing swap tests).

- [ ] **Step 5: Full verification**

Run: `npx vitest run && npm run typecheck && npx eslint src/ui/store/store.ts src/ui/store/store.test.ts`
Expected: all green. (The existing swap e2e in `symbols.spec.ts` still passes — swap of a placed
instance between equal-box symbols is Δ=0; verify it didn't regress.)

- [ ] **Step 6: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "fix(swap-symbol): recompute anchor to new content centre + compensate base/keyframes (47d)"
```

---

## Self-Review

- **Spec coverage:** recompute + Δ on base + Δ on x/y keyframes + empty-symbol guard + undo — all
  have a task step / test.
- **Placeholder scan:** the "NOTE before running" verifies `createSceneObject` base override,
  `shapeBase`, and `Keyframe.easing` literal — real checks, with the snapping.test.ts model cited.
- **Type consistency:** `repoint: (o: SceneObject) => SceneObject`; track values stay `number`; anchor
  fields match `SceneObject.anchorX/anchorY`.
