# Multi-Select MOVE Previews Node-less Containers Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A group or symbol instance in a multi-selection live-previews during a MOVE drag (today it
freezes until pointer-up).

**Architecture:** Generalise the multi-select MOVE preview loop to dispatch node-less containers to the
existing `previewGroupChildren` / `previewInstanceChildren`, mirroring the scale/rotate loops. Editor
preview chrome only.

**Tech Stack:** React 18 + TS strict, Vitest + RTL.

## Global Constraints
- preview == export parity (imperative drag-preview only; commit path unchanged).
- TS strict; reuse existing helpers.

---

### Task 1: Container dispatch in the multi-MOVE preview loop

**Files:** Modify `src/ui/components/Stage/Stage.tsx` (the `d.multi` move loop, ~lines 1102-1111);
Test `src/ui/components/Stage/Stage.test.tsx`.

**Interfaces:**
- Consumes: `previewGroupChildren(proj, groupId, time, prefix)`, `previewInstanceChildren(proj, instance, time, base)`,
  `isSymbolInstance(obj, assets)`, `sampleObject`, `resolveObjectAnchor`, `buildTransform` — all already in the file.

- [ ] **Step 1: Failing Stage test** — append to Stage.test.tsx (mirror the multi-drag test ~885 +
the instance fixture ~1251; `stubIdentityCTM()` is required for the screen↔SVG drag mapping):

```tsx
it('previews a symbol instance leaf during a multi-select move drag (47b polish)', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 50 });
  const a = useEditor.getState().selectedObjectId!;
  const project = useEditor.getState().history.present;
  const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
  const innerObj = createSceneObject('inner-asset', { id: 'inner', zOrder: 0 });
  innerObj.shapeBase = { width: 20, height: 20 };
  const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj], width: 20, height: 20 });
  const instance = createSceneObject('sym-1', { id: 'inst', name: 'inst', zOrder: 1, base: { x: 200, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
  act(() => {
    useEditor.getState().commit({ ...project, assets: [...project.assets, inner, sym], objects: [...project.objects, instance] });
    useEditor.getState().selectObjects([a, 'inst']);
  });
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const id of [a]) nodes.set(id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  // the instance renders as a composite leaf node 'inst/inner'
  nodes.set('inst/inner', document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  const { container } = render(<Stage nodes={nodes} />);
  const before = nodes.get('inst/inner')!.getAttribute('transform') ?? '';
  // begin a move drag on the plain rect (a member of the multi-selection) and move by +40,+0
  const elA = container.querySelector(`[data-savig-object="${a}"]`)!;
  fireEvent.pointerDown(elA, { clientX: 10, clientY: 10, button: 0 });
  fireEvent.pointerMove(window, { clientX: 50, clientY: 10 });
  const after = nodes.get('inst/inner')!.getAttribute('transform') ?? '';
  expect(after).not.toBe(before); // the instance leaf followed the multi-drag (was static before)
  fireEvent.pointerUp(window);
});
```

NOTE before running: confirm the multi-drag begins via `pointerDown` on a selected member then
`pointerMove` on `window` (the ~885 test is the authoritative gesture — copy its exact events/targets,
incl. any `shiftKey`/selection setup). Confirm `selectObjects` selects both and that the instance leaf
renders under `data-savig-object="inst/inner"` so a node registered at that key is the one
`previewInstanceChildren` writes. If the gesture differs, mirror ~885 precisely.

- [ ] **Step 2: Run → fails** (`-t "previews a symbol instance leaf during a multi-select move"`): the
leaf transform is unchanged (loop `continue`s on the missing instance node).

- [ ] **Step 3:** In `Stage.tsx`, replace the multi-MOVE preview loop body (~1102-1111):

```tsx
        for (const it of d.multi.items) {
          const obj = proj.objects.find((o) => o.id === it.id);
          const node = nodes.get(it.id);
          if (!obj || !node) continue;
          const sampled = sampleObject(obj, time);
          const resolved = resolveObjectAnchor(obj, proj.assets.find((a) => a.id === obj.assetId), sampled);
          const ax = resolved ? resolved.anchorX : obj.anchorX;
          const ay = resolved ? resolved.anchorY : obj.anchorY;
          node.setAttribute('transform', buildTransform({ ...sampled, x: it.ox + dx, y: it.oy + dy }, ax, ay));
        }
```

with:

```tsx
        for (const it of d.multi.items) {
          const obj = proj.objects.find((o) => o.id === it.id);
          if (!obj) continue;
          const sampled = sampleObject(obj, time);
          const resolved = resolveObjectAnchor(obj, proj.assets.find((a) => a.id === obj.assetId), sampled);
          const ax = resolved ? resolved.anchorX : obj.anchorX;
          const ay = resolved ? resolved.anchorY : obj.anchorY;
          const nx = it.ox + dx;
          const ny = it.oy + dy;
          const xf = buildTransform({ ...sampled, x: nx, y: ny }, ax, ay);
          const node = nodes.get(it.id);
          if (node) node.setAttribute('transform', xf);
          else if (obj.isGroup) previewGroupChildren(proj, obj.id, time, xf); // group has no node — preview its children
          else if (isSymbolInstance(obj, proj.assets))
            previewInstanceChildren(proj, obj, time, { x: nx, y: ny, scaleX: sampled.scaleX, scaleY: sampled.scaleY, rotation: sampled.rotation, opacity: sampled.opacity }); // instance has no node — preview its leaves
        }
```

(`setDragOffset({ dx, dy })` after the loop is unchanged.)

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Full verify** — `npx vitest run src/ui/components/Stage && npm run typecheck && npx eslint src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx`.

- [ ] **Step 6: Commit** `fix(stage): multi-select MOVE previews groups & instances (47b polish)`.

---

## Self-Review
- Spec coverage: the loop dispatch (Step 3) + the instance-leaf-preview test (Step 1).
- Placeholders: the "NOTE before running" verifies the real multi-drag gesture (the ~885 test) + leaf
  node key — concrete checks.
- Type consistency: the dispatch matches the scale/rotate loops verbatim (`previewGroupChildren`/
  `previewInstanceChildren` signatures already used at ~848-850 / ~877-879).
