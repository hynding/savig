# Savig M4 — Multi-Select MOVE Previews Node-less Containers (47b polish)

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — a bounded 47b live-preview gap.

---

## 1. Motivation

During a multi-select MOVE drag, Stage previews each member by writing its transform imperatively to
`nodes.get(it.id)`. A GROUP container and a symbol INSTANCE are **node-less** (a group composes onto
its children at compute time; an instance renders as composite-id `instId/childId` leaves) — so
`nodes.get(it.id)` is `null` and the loop `continue`s. The result: a group or instance in a
multi-selection **freezes in place** during the move drag and only jumps to the new spot on
pointer-up. The commit is correct; only the live preview is missing.

The single-object drag, and the group-handle SCALE and ROTATE loops, already handle this: they
dispatch node-less containers to `previewGroupChildren(proj, groupId, time, xf)` /
`previewInstanceChildren(proj, instance, time, base)`. The MOVE loop was simply never given the same
dispatch.

## 2. Approach

Generalise the multi-select MOVE preview loop to mirror the scale/rotate loops exactly: compute the
member's previewed transform, then `node ? setAttribute : group ? previewGroupChildren : instance ?
previewInstanceChildren`.

```ts
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
    previewInstanceChildren(proj, obj, time, { x: nx, y: ny, scaleX: sampled.scaleX, scaleY: sampled.scaleY, rotation: sampled.rotation, opacity: sampled.opacity });
}
```

This is the same shape as the scale loop (lines ~837-851) and rotate loop (~866-880); only the
transform values differ (a pure translate to `it.ox+dx, it.oy+dy`). The previous code computed the
anchor and called `node.setAttribute` only — the new code keeps that path for plain objects and adds
the two container branches. `previewGroupChildren`/`previewInstanceChildren`/`isSymbolInstance` are
already defined and used in the same component.

## 3. Scope

**In:** the container dispatch in the multi-select MOVE preview loop; a Stage test asserting an
instance member's leaf node transform updates during a multi-drag.

**Out / unchanged:**
- The commit on pointer-up (`nudgeSelected` with the snapped delta) — already correct for all kinds.
- The snapping, the group/single scale/rotate loops, the dashed outline (`dragOffset`-driven) — all
  unchanged. (The dashed outline already follows via `setDragOffset`, which stays.)
- Engine/store/render — untouched.

## 4. Parity & regression-safety

- **Parity:** editor preview chrome only (imperative node writes during a drag); never touches the
  committed project, `flattenInstances`, or export → preview==export untouched.
- **Regression-safe:** for a plain object the path is unchanged (`node` present → `setAttribute`); only
  node-less members (previously skipped) gain a preview. The previewed transforms are recomputed every
  move and superseded by the authoritative re-render on commit.

## 5. Testing strategy

`Stage.test.tsx` (mirror the existing multi-drag test ~885 + the instance fixture ~1251):
- Build a plain rect + a symbol instance (with a registered leaf node `inst/inner`), select both,
  begin a drag on the plain rect and move by a known delta, then assert the instance's leaf node
  (`nodes.get('inst/inner')`) transform reflects the translation (it was static before). Use
  `stubIdentityCTM()` since the drag uses screen↔SVG mapping.
