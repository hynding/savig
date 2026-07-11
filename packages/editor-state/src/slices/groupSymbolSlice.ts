// Grouping, nested symbols, asset library management, and boolean path ops. Extracted
// verbatim from store.ts (no behavior change). These actions are all active-scene aware
// (root or an edited symbol) and route through the shared scene helpers.
import {
  createGroupObject,
  createSymbolAsset,
  createSceneObject,
  createVectorAsset,
  newId,
  snapToFrame,
  sampleObject,
  bakeGroupIntoChild,
  unbakeGroupFromChild,
  collectReferencedAssetIds,
  booleanOp as booleanOpEngine,
  ringArea,
  pathBounds,
  symbolContains,
  countSymbolInstances,
  DEFAULT_TRANSFORM,
  DEFAULT_VECTOR_STYLE,
  objectToWorldPolygon,
  pc,
  parentGroupOf,
  resolveAnchor,
} from '@savig/engine';
import type { SceneObject, VectorAsset, PathData, PathPoint, Project, BoolOp } from '@savig/engine';
import { objectAABB, groupAABB, resolveObjectAnchor, groupBBox, sceneContentAABB, isSymbolInstance } from '@savig/interaction';
import { selectActiveObjects, selectActiveAssetId, selectActiveScope } from '../selectors';
import {
  withSceneObjects,
  replaceObjectInScene,
  nextZOrder,
  resolveToEntity,
  expandToGroups,
  isShapeBuilderEligible,
  omitPrimitiveTracks,
  dropTrimAndDash,
  type SliceCreator,
  type SceneScope,
} from '../store-internals';

type GroupSymbolKeys =
  | 'groupSelected' | 'ungroupSelected' | 'createSymbol' | 'placeSymbolInstance'
  | 'placeSymbolInstanceAt' | 'swapSymbol' | 'renameAsset' | 'deleteSymbol' | 'deleteAsset'
  | 'booleanOp' | 'reparentObject' | 'setGroupTransform' | 'selectObjectOrGroup'
  | 'toggleObjectOrGroup' | 'selectObjectsExpandingGroups'
  | 'enterShapeBuilder' | 'exitShapeBuilder' | 'shapeBuilderMerge' | 'shapeBuilderPunch';

/** Shared destructive-boolean post-processing (factored out of `booleanOp`'s non-live branch —
 *  art-tools #7 Task 2 — so `shapeBuilderMerge` can reuse it exactly): given the engine's raw clip
 *  `rings` for `operands` (already computed via `booleanOpEngine`), builds the merged vector
 *  object + asset (style from the topmost contributing vector-leaf descendant; multi-ring results
 *  bbox-shifted to origin, largest ring -> `path`, the rest -> `compoundRings`), removes every
 *  operand (and, for a GROUP operand, its whole subtree) from `scopeObjects`, appends the result,
 *  and cross-scene prunes any now-orphaned source vector assets. Returns the next project (NOT
 *  committed) + the new object — callers commit and handle selection/mode bookkeeping themselves:
 *  `booleanOp` selects the result; `shapeBuilderMerge` instead splices the frozen
 *  `shapeBuilder.ids` and leaves the live selection untouched (design decision 1 — "selection is
 *  left alone during the mode"). `op` only feeds the result's display name. */
function applyBooleanResult(
  project: Project,
  scopeObjects: SceneObject[],
  scope: SceneScope,
  operands: SceneObject[],
  rings: PathData[],
  op: BoolOp,
): { project: Project; obj: SceneObject } {
  const vectorLeavesOf = (o: SceneObject): SceneObject[] => {
    if (!o.isGroup) {
      const a = project.assets.find((x) => x.id === o.assetId);
      return a?.kind === 'vector' ? [o] : [];
    }
    return scopeObjects.filter((c) => c.parentId === o.id).flatMap(vectorLeavesOf);
  };
  const descendantIdsOf = (id: string): string[] =>
    scopeObjects.filter((o) => o.parentId === id).flatMap((c) => [c.id, ...descendantIdsOf(c.id)]);

  // primary = largest-area ring; the rest become compound rings (holes/disjoint pieces).
  const sorted = rings
    .slice()
    .sort((a, b) => Math.abs(ringArea(b.nodes.map((n) => n.anchor))) - Math.abs(ringArea(a.nodes.map((n) => n.anchor))));
  const box = sorted.reduce(
    (acc, r) => {
      const b = pathBounds(r);
      return {
        minX: Math.min(acc.minX, b.x),
        minY: Math.min(acc.minY, b.y),
        maxX: Math.max(acc.maxX, b.x + b.width),
        maxY: Math.max(acc.maxY, b.y + b.height),
      };
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  const shift = (p: PathData): PathData => ({
    closed: p.closed,
    // spread keeps in/out bezier handles (anchor-relative offsets, translation-invariant)
    // so curve-preserved boolean results survive; only the anchor is translated.
    nodes: p.nodes.map((n) => ({ ...n, anchor: { x: n.anchor.x - box.minX, y: n.anchor.y - box.minY } })),
  });
  const primary = shift(sorted[0]);
  const compoundRings = sorted.slice(1).map(shift);

  // Inherit the style of the topmost contributing vector LEAF (a group/SVG has no VectorStyle of
  // its own; an all-SVG selection -> default style).
  const allLeaves = operands.flatMap(vectorLeavesOf);
  const topLeaf = allLeaves.slice().sort((a, b) => b.zOrder - a.zOrder)[0];
  const bakedStyle = topLeaf
    ? { ...(project.assets.find((x) => x.id === topLeaf.assetId) as VectorAsset).style }
    : { ...DEFAULT_VECTOR_STYLE };

  const asset = createVectorAsset('path', {
    path: primary,
    ...(compoundRings.length > 0 ? { compoundRings } : {}),
    style: bakedStyle,
  });
  const label = `${op[0].toUpperCase()}${op.slice(1)}`;
  const obj = createSceneObject(asset.id, {
    name: `${label} ${nextZOrder(scopeObjects) + 1}`,
    zOrder: nextZOrder(scopeObjects),
    anchorMode: 'fraction',
    anchorX: 0.5,
    anchorY: 0.5,
    base: { ...DEFAULT_TRANSFORM, x: box.minX, y: box.minY },
  });

  // Remove every operand AND a group operand's whole subtree (the group is consumed into the result).
  const removed = new Set<string>();
  for (const o of operands) {
    removed.add(o.id);
    for (const d of descendantIdsOf(o.id)) removed.add(d);
  }
  const nextObjects = [...scopeObjects.filter((o) => !removed.has(o.id)), obj];
  // Write the result object to the ACTIVE scene + add the new vector asset GLOBAL.
  let nextProject = withSceneObjects(project, scope, nextObjects);
  nextProject = { ...nextProject, assets: [...nextProject.assets, asset] };
  // Cross-scene, symbol-preserving prune of the now-orphaned SOURCE vector assets (phase-1 style):
  // keep a source asset if it is still referenced anywhere (root + every symbol scene); never prune
  // symbol (library) / audio assets (the sources are vector anyway).
  const candidateAssetIds = new Set(scopeObjects.filter((o) => removed.has(o.id)).map((o) => o.assetId));
  const referenced = collectReferencedAssetIds(nextProject);
  nextProject = {
    ...nextProject,
    assets: nextProject.assets.filter((a) => {
      if (!candidateAssetIds.has(a.id)) return true;
      if (a.kind === 'symbol' || a.kind === 'audio') return true;
      return referenced.has(a.id);
    }),
  };
  return { project: nextProject, obj };
}

// --- Shape Builder (art-tools #7) low-level polygon-clipping helpers -----------------------------
// Local mirrors of boolean.ts's PRIVATE `pc` ring<->PathData converters (not exported — same
// local-mirror precedent Task 1's regions.ts used for the PcPolygon/PcRing aliases): structurally
// compatible with the `pc` binding's own Ring type ([number,number][]), so no type import needed.

// VectorAsset minus compoundRings — destructuring-exclusion on a FUNCTION PARAMETER (not a local
// var) so the unused binding is covered by eslint's `argsIgnorePattern: '^_'` (the omitDashFields/
// dropTrimAndDash precedent in store.ts/store-internals.ts). Used by shapeBuilderPunch's
// write-back so a stale pre-punch compoundRings never leaks through the asset-update spread.
function omitCompoundRings({ compoundRings: _compoundRings, ...rest }: VectorAsset): Omit<VectorAsset, 'compoundRings'> {
  return rest;
}

/** A corner-node PathData ring -> a closed (first===last) polygon-clipping ring. */
function pathDataToPcRing(p: PathData): [number, number][] {
  const pts = p.nodes.map((n): [number, number] => [n.anchor.x, n.anchor.y]);
  if (pts.length > 0) pts.push(pts[0]); // close GeoJSON-style, mirrors objectToWorldPolygon
  return pts;
}

/** The inverse of `pathDataToPcRing`: mirrors boolean.ts's private `ringToPathData` — drop the
 *  closing duplicate, emit corner-only nodes (no curve provenance; punch is a flat re-parameterize,
 *  same as scissors/setPathData's node-edit detach). */
function pcRingToPathData(ring: readonly (readonly [number, number])[]): PathData {
  const closed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const pts = closed ? ring.slice(0, -1) : ring;
  return { closed: true, nodes: pts.map(([x, y]) => ({ anchor: { x, y } })) };
}

/** Algebraic inverse of `groupTransform.mapPoint` (rotation matrices are orthogonal, so R^-1 =
 *  R^T): given the SAME `(t, ax, ay)` a forward `mapPoint` call used, recovers the local point
 *  that produced world point `(wx, wy)`. */
function invMapPoint(
  t: { x: number; y: number; scaleX: number; scaleY: number; rotation: number },
  ax: number,
  ay: number,
  wx: number,
  wy: number,
): PathPoint {
  const rad = (t.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const ux = wx - t.x - ax;
  const uy = wy - t.y - ay;
  const ex = c * ux + s * uy;
  const ey = -s * ux + c * uy;
  const sx = t.scaleX === 0 ? 1e-9 : t.scaleX; // guard: a zero-scaled object has no invertible world mapping
  const sy = t.scaleY === 0 ? 1e-9 : t.scaleY;
  return { x: ax + ex / sx, y: ay + ey / sy };
}

/** World -> local point, exactly inverting the SAME chain engine's `objectToWorldPolygon`/`toWorld`
 *  compose (object transform, then each group-ancestor transform, innermost first — see
 *  `groupTransform.mapPoint` + `parentGroupOf`): rebuild that ancestor chain over `scopeObjects`
 *  (the SAME objects list passed to `objectToWorldPolygon` as `{ ...project, objects: scopeObjects
 *  }` — the active-scene-scoped call groupSymbolSlice's other actions already use for engine calls,
 *  e.g. `booleanOpEngine({ ...project, objects: activeObjects }, ...)`), then invert each `mapPoint`
 *  in REVERSE application order (last-applied undone first). Forward+inverse round-trip exactly
 *  whatever scope the chain resolved — this is the "world→local inverse" choice (design doc
 *  decision 5 / Task 2 brief): computing in world space (matching the region math) and inverting
 *  back, rather than re-deriving the region in every contributor's own local frame. */
function worldPointToLocal(
  scopeObjects: SceneObject[],
  obj: SceneObject,
  ax: number,
  ay: number,
  w: PathPoint,
  time: number,
): PathPoint {
  const chain: { t: ReturnType<typeof sampleObject>; ax: number; ay: number }[] = [{ t: sampleObject(obj, time), ax, ay }];
  let cur = parentGroupOf(scopeObjects, obj);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push({ t: sampleObject(cur, time), ax: cur.anchorX, ay: cur.anchorY });
    cur = parentGroupOf(scopeObjects, cur);
  }
  let p = w;
  for (let i = chain.length - 1; i >= 0; i--) {
    p = invMapPoint(chain[i].t, chain[i].ax, chain[i].ay, p.x, p.y);
  }
  return p;
}

export const createGroupSymbolSlice: SliceCreator<GroupSymbolKeys> = (set, get) => ({
  groupSelected() {
    const s = get();
    const project = s.history.present;
    const activeObjects = selectActiveObjects(s);
    const time = snapToFrame(s.time, project.meta.fps);
    // Group the selected TOP-LEVEL non-locked objects (incl. top-level GROUPS — nesting, 45e)
    // into a new container. Exclude objects already in a group (`parentId`) — only top-level
    // entities are grouped, so no cycle. The group's anchor = the selection bbox centre.
    const targets = s.selectedObjectIds
      .map((id) => activeObjects.find((o) => o.id === id))
      .filter((o): o is SceneObject => !!o && !o.locked && !o.parentId);
    if (targets.length < 2) return;
    const boxes = targets
      .map((o) =>
        o.isGroup
          ? groupAABB(o, activeObjects, project.assets, time)
          : objectAABB(o, project.assets.find((a) => a.id === o.assetId), time),
      )
      .filter((b): b is NonNullable<typeof b> => !!b);
    const bb = groupBBox(boxes);
    const cx = bb ? (bb.minX + bb.maxX) / 2 : 0;
    const cy = bb ? (bb.minY + bb.maxY) / 2 : 0;
    const gid = newId();
    const group = createGroupObject({ id: gid, anchorX: cx, anchorY: cy, zOrder: Math.max(...targets.map((o) => o.zOrder)) + 1 });
    const ids = new Set(targets.map((o) => o.id));
    const objects = [...activeObjects.map((o) => (ids.has(o.id) ? { ...o, parentId: gid } : o)), group];
    get().commitActiveScene(objects);
    get().selectObject(gid);
  },
  ungroupSelected() {
    const s = get();
    const project = s.history.present;
    const activeObjects = selectActiveObjects(s);
    const time = snapToFrame(s.time, project.meta.fps);
    const groups = s.selectedObjectIds
      .map((id) => activeObjects.find((o) => o.id === id))
      .filter((o): o is SceneObject => !!o?.isGroup);
    if (groups.length === 0) return;
    const groupIds = new Set(groups.map((g) => g.id));
    const freed: string[] = [];
    const objects = activeObjects
      .map((o) => {
        if (!o.parentId || !groupIds.has(o.parentId)) return o;
        const group = groups.find((g) => g.id === o.parentId)!;
        const oAsset = project.assets.find((a) => a.id === o.assetId);
        const r = resolveObjectAnchor(o, oAsset, sampleObject(o, time, oAsset?.kind === 'vector' ? oAsset.primitive : undefined));
        if (!groupIds.has(o.id)) freed.push(o.id); // select the surviving freed children (incl. a surviving child group); skip only the dissolved groups removed below
        // Bake the group's transform into the child, then REPARENT to the first SURVIVING
        // ancestor (skip any ancestor groups also being dissolved in this call), so ungrouping
        // nested groups at once never leaves a dangling parentId (45e).
        let survivorParent = group.parentId;
        const seen = new Set<string>();
        while (survivorParent && groupIds.has(survivorParent) && !seen.has(survivorParent)) {
          seen.add(survivorParent);
          survivorParent = groups.find((g) => g.id === survivorParent)?.parentId;
        }
        return { ...bakeGroupIntoChild(group, o, r ? r.anchorX : o.anchorX, r ? r.anchorY : o.anchorY), parentId: survivorParent };
      })
      .filter((o) => !groupIds.has(o.id)); // remove the dissolved group containers
    get().commitActiveScene(objects);
    get().selectObjects(freed);
  },
  createSymbol() {
    const s = get();
    const project = s.history.present;
    const time = snapToFrame(s.time, project.meta.fps);
    const sceneObjects = selectActiveObjects(s);
    // Selected top-level, non-locked objects (groups allowed as members, like grouping).
    const targets = s.selectedObjectIds
      .map((id) => sceneObjects.find((o) => o.id === id))
      .filter((o): o is SceneObject => !!o && !o.locked && !o.parentId);
    if (targets.length < 1) return;
    const ids = new Set(targets.map((o) => o.id));
    // Pull in the members' group DESCENDANTS (a grouped member carries its whole subtree into
    // the symbol scene, so `parentId` references stay resolvable inside the SymbolAsset).
    const descendantIds = new Set(ids);
    let grew = true;
    while (grew) {
      grew = false;
      for (const o of sceneObjects) {
        if (o.parentId && descendantIds.has(o.parentId) && !descendantIds.has(o.id)) {
          descendantIds.add(o.id);
          grew = true;
        }
      }
    }
    // The instance is an IDENTITY wrapper anchored at the selection-bbox centre; members keep
    // their authored coordinates inside the symbol -> the result renders byte-identical (parity).
    const boxes = targets
      .map((o) =>
        o.isGroup
          ? groupAABB(o, sceneObjects, project.assets, time)
          : objectAABB(o, project.assets.find((a) => a.id === o.assetId), time),
      )
      .filter((b): b is NonNullable<typeof b> => !!b);
    const bb = groupBBox(boxes);
    const cx = bb ? (bb.minX + bb.maxX) / 2 : 0;
    const cy = bb ? (bb.minY + bb.maxY) / 2 : 0;
    const width = bb ? bb.maxX - bb.minX : 0;
    const height = bb ? bb.maxY - bb.minY : 0;
    const symbolObjects = sceneObjects.filter((o) => descendantIds.has(o.id));
    const symId = newId();
    const symbol = createSymbolAsset({ id: symId, name: 'Symbol', objects: symbolObjects, width, height });
    const instance = createSceneObject(symId, {
      id: newId(),
      name: 'Symbol',
      zOrder: Math.max(...targets.map((o) => o.zOrder)) + 1,
      anchorX: cx,
      anchorY: cy,
    });
    const nextObjects = [...sceneObjects.filter((o) => !descendantIds.has(o.id)), instance];
    get().commit(withSceneObjects({ ...project, assets: [...project.assets, symbol] }, selectActiveScope(s), nextObjects));
    get().selectObject(instance.id);
  },
  placeSymbolInstance(symId) {
    const s = get();
    const project = s.history.present;
    const symbol = project.assets.find((a) => a.id === symId);
    if (!symbol || symbol.kind !== 'symbol') return;
    const containing = selectActiveAssetId(s);
    if (containing && (symId === containing || symbolContains(symId, containing, project.assets))) {
      get().pushToast('error', `Can't place ${symbol.name} here — it would contain itself.`);
      return;
    }
    const objects = selectActiveObjects(s);
    const time = snapToFrame(s.time, project.meta.fps);
    const box = sceneContentAABB(symbol.objects, project.assets, time);
    const cx = box ? (box.minX + box.maxX) / 2 : 0;
    const cy = box ? (box.minY + box.maxY) / 2 : 0;
    const instance = createSceneObject(symId, {
      name: `${symbol.name} ${nextZOrder(objects) + 1}`,
      zOrder: nextZOrder(objects),
      anchorX: cx,
      anchorY: cy,
    });
    get().commitActiveScene([...objects, instance]);
    get().selectObject(instance.id);
  },
  placeSymbolInstanceAt(symId, x, y) {
    const s = get();
    const project = s.history.present;
    const symbol = project.assets.find((a) => a.id === symId);
    if (!symbol || symbol.kind !== 'symbol') return;
    const containing = selectActiveAssetId(s);
    if (containing && (symId === containing || symbolContains(symId, containing, project.assets))) {
      get().pushToast('error', `Can't place ${symbol.name} here — it would contain itself.`);
      return;
    }
    const objects = selectActiveObjects(s);
    const time = snapToFrame(s.time, project.meta.fps);
    const box = sceneContentAABB(symbol.objects, project.assets, time);
    const cx = box ? (box.minX + box.maxX) / 2 : 0;
    const cy = box ? (box.minY + box.maxY) / 2 : 0;
    const instance = createSceneObject(symId, {
      name: `${symbol.name} ${nextZOrder(objects) + 1}`,
      zOrder: nextZOrder(objects),
      anchorX: cx,
      anchorY: cy,
      base: { ...DEFAULT_TRANSFORM, x: x - cx, y: y - cy },
    });
    get().commitActiveScene([...objects, instance]);
    get().selectObject(instance.id);
  },
  swapSymbol(instanceId, newSymId) {
    const s = get();
    const project = s.history.present;
    const objects = selectActiveObjects(s);
    const inst = objects.find((o) => o.id === instanceId);
    if (!inst || !isSymbolInstance(inst, project.assets) || inst.assetId === newSymId) return;
    const newSym = project.assets.find((a) => a.id === newSymId);
    if (!newSym || newSym.kind !== 'symbol') return;
    const containing = selectActiveAssetId(s);
    if (containing && (newSymId === containing || symbolContains(newSymId, containing, project.assets))) {
      get().pushToast('error', `Can't swap to ${newSym.name} — it would contain itself.`);
      return;
    }
    // Re-centre the anchor on the NEW symbol's content box and compensate the translation so the
    // pivot's world position (base + anchor) is unchanged — the instance keeps its spot, no jump (47d).
    // x/y tracks store ABSOLUTE values (sampleObject ignores base when a track exists), so the delta
    // applies to base AND every x/y keyframe.
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
        // A motion path overrides x/y in sampleObject, so the base/track shift alone wouldn't move the
        // pivot for a motion-path instance — translate the path's node anchors by the same delta (in/out
        // handles are relative offsets, unchanged). Absent motionPath → key stays absent. (47d)
        ...(o.motionPath
          ? {
              motionPath: {
                ...o.motionPath,
                path: {
                  ...o.motionPath.path,
                  nodes: o.motionPath.path.nodes.map((n) => ({ ...n, anchor: { x: n.anchor.x + dx, y: n.anchor.y + dy } })),
                },
              },
            }
          : {}),
      };
    };
    get().commitActiveScene(objects.map((o) => (o.id === instanceId ? repoint(o) : o)));
  },
  renameAsset(assetId, name) {
    const s = get();
    const project = s.history.present;
    const asset = project.assets.find((a) => a.id === assetId);
    const trimmed = name.trim();
    if (!asset || !trimmed || asset.name === trimmed) return;
    get().commit({ ...project, assets: project.assets.map((a) => (a.id === assetId ? { ...a, name: trimmed } : a)) });
  },
  deleteSymbol(symId) {
    const s = get();
    const project = s.history.present;
    const sym = project.assets.find((a) => a.id === symId);
    if (!sym || sym.kind !== 'symbol') return;
    const count = countSymbolInstances(symId, project);
    if (count > 0) {
      get().pushToast('error', `Can't delete "${sym.name}" — it has ${count} instance${count === 1 ? '' : 's'}.`);
      return;
    }
    // Remove the symbol, then cross-scene prune its now-orphaned vector/svg internal assets (keep
    // symbol/audio; keep anything still referenced anywhere) — the phase-1/boolean prune predicate.
    let next = { ...project, assets: project.assets.filter((a) => a.id !== symId) };
    const referenced = collectReferencedAssetIds(next);
    next = { ...next, assets: next.assets.filter((a) => a.kind === 'symbol' || a.kind === 'audio' || referenced.has(a.id)) };
    get().commit(next);
  },
  deleteAsset(assetId) {
    const s = get();
    const project = s.history.present;
    const asset = project.assets.find((a) => a.id === assetId);
    if (!asset || asset.kind === 'symbol') return; // symbols use deleteSymbol
    const inUse =
      collectReferencedAssetIds(project).has(assetId) ||
      project.audioClips.some((c) => c.assetId === assetId);
    if (inUse) {
      get().pushToast('error', `Can't delete "${asset.name}" — it's in use.`);
      return;
    }
    get().commit({ ...project, assets: project.assets.filter((a) => a.id !== assetId) });
  },
  booleanOp(op, opts) {
    const s = get();
    const project = s.history.present;
    const activeObjects = selectActiveObjects(s);
    const activeScope = selectActiveScope(s);
    const activeAssetId = activeScope.assetId;
    const time = snapToFrame(s.time, project.meta.fps);
    // A boolean operand's contributing vector-leaf objects: a vector leaf is itself; a GROUP expands
    // to its vector-leaf descendants (recursive). Non-vector leaves contribute nothing.
    const vectorLeavesOf = (o: SceneObject): SceneObject[] => {
      if (!o.isGroup) {
        const a = project.assets.find((x) => x.id === o.assetId);
        return a?.kind === 'vector' ? [o] : [];
      }
      return activeObjects.filter((c) => c.parentId === o.id).flatMap(vectorLeavesOf);
    };

    // A DIRECT SVG-asset object is a boolean operand (its filled silhouette joins the clip), but it
    // has no VectorStyle — keep it OUT of vectorLeavesOf (the style source) and admit it only here.
    const isSvgOperand = (o: SceneObject): boolean =>
      !o.isGroup && project.assets.find((a) => a.id === o.assetId)?.kind === 'svg';

    const eligible = s.selectedObjectIds
      .map((id) => activeObjects.find((o) => o.id === id))
      .filter((o): o is SceneObject => !!o && (vectorLeavesOf(o).length > 0 || isSvgOperand(o)));

    // Live booleans are ROOT-SCENE only in slice 1/2: their render (flattenInstances consumed-skip
    // + resolveBooleanRings) resolves operandIds against root `project.objects`. Inside a symbol
    // edit scene (activeAssetId != null) authoring one would render empty with operands still
    // visible, so fall through to the (scene-agnostic) destructive boolean there instead.
    if (opts?.live && activeAssetId === null) {
      // Author a LIVE (animated) boolean: a SceneObject.boolean node that re-clips its operands
      // every frame (slice 1 render). KEEP the operands. Operands = geometry-contributing selected
      // objects: a vector leaf, a GROUP with vector leaves (union of its leaves), or another LIVE
      // BOOLEAN (its own result). `eligible` already captures exactly this (vectorLeavesOf(o).length
      // > 0), so the live path now matches the buttons' `canBool` enablement — an enabled Alt+click
      // always forms a live boolean (slice 3b lifted the slice-2 leaf-only restriction).
      const liveOperands = eligible;
      // Self-gate: never a silent partial op (e.g. one operand selected, or disjoint intersect).
      if (liveOperands.length < 2) return;

      const z = nextZOrder(activeObjects);
      // Style from the topmost-zOrder VECTOR LEAF reachable from the operands (a group/boolean/SVG has
      // no direct VectorStyle, so descend via vectorLeavesOf; an all-SVG selection -> default style).
      const topLeaf = liveOperands.flatMap(vectorLeavesOf).slice().sort((a, b) => b.zOrder - a.zOrder)[0];
      const liveStyle = topLeaf
        ? { ...(project.assets.find((x) => x.id === topLeaf.assetId) as VectorAsset).style }
        : { ...DEFAULT_VECTOR_STYLE };
      const asset = createVectorAsset('path', { path: { nodes: [], closed: false }, style: liveStyle });
      const label = `${op[0].toUpperCase()}${op.slice(1)}`;
      const obj = createSceneObject(asset.id, {
        name: `Animated ${label} ${z + 1}`,
        zOrder: z,
        anchorMode: 'fraction',
        anchorX: 0.5,
        anchorY: 0.5,
        base: { ...DEFAULT_TRANSFORM },
        boolean: { op, operandIds: liveOperands.map((o) => o.id) },
      });
      const nextObjects = [...activeObjects, obj];
      let nextProject = withSceneObjects(project, activeScope, nextObjects);
      nextProject = { ...nextProject, assets: [...nextProject.assets, asset] };
      get().commit(nextProject);
      set({ selectedObjectId: obj.id, selectedObjectIds: [obj.id], selectedKeyframe: null, selectedNodeIndex: null });
      return;
    }

    if (eligible.length < 2) return; // gate: never a silent partial op (a group counts as one operand)

    const rings = booleanOpEngine({ ...project, objects: activeObjects }, eligible, op, time); // world space (active scene)
    if (rings.length === 0) return; // empty/degenerate -> no-op

    const { project: nextProject, obj } = applyBooleanResult(project, activeObjects, activeScope, eligible, rings, op);
    get().commit(nextProject);
    set({ selectedObjectId: obj.id, selectedObjectIds: [obj.id], selectedKeyframe: null, selectedNodeIndex: null });
  },
  reparentObject(id, newParentId) {
    const s = get();
    const project = s.history.present;
    const objs = selectActiveObjects(s);
    const o0 = objs.find((x) => x.id === id);
    if (!o0) return;
    if ((o0.parentId ?? null) === newParentId) return; // no-op: same parent (reorder is a separate path)
    if (newParentId) {
      const np = objs.find((x) => x.id === newParentId);
      if (!np?.isGroup) return; // can only drop INTO a group
      // Cycle guard: the new parent must not be the object itself or a descendant of it.
      const seen = new Set<string>();
      for (let cur: SceneObject | undefined = np; cur && !seen.has(cur.id); ) {
        if (cur.id === id) return; // would nest a group inside itself / its own subtree
        seen.add(cur.id);
        cur = cur.parentId ? objs.find((x) => x.id === cur!.parentId) : undefined;
      }
    }
    const parentGroup = (o: SceneObject) => (o.parentId ? objs.find((x) => x.id === o.parentId && x.isGroup) : undefined);
    const o0Asset = project.assets.find((a) => a.id === o0.assetId);
    const r = resolveObjectAnchor(o0, o0Asset, sampleObject(o0, snapToFrame(s.time, project.meta.fps), o0Asset?.kind === 'vector' ? o0Asset.primitive : undefined));
    const ax = r ? r.anchorX : o0.anchorX;
    const ay = r ? r.anchorY : o0.anchorY;
    // Bake OUT of the whole old ancestor chain (immediate → outermost) → world space.
    let cur = o0;
    for (let g = parentGroup(o0); g; g = parentGroup(g)) cur = bakeGroupIntoChild(g, cur, ax, ay);
    // Unbake INTO the new chain (outermost → immediate).
    const newChain: SceneObject[] = [];
    for (let g = newParentId ? objs.find((x) => x.id === newParentId && x.isGroup) : undefined; g; g = parentGroup(g)) newChain.push(g);
    for (const g of newChain.reverse()) cur = unbakeGroupFromChild(g, cur, ax, ay);
    cur = { ...cur, parentId: newParentId ?? undefined };
    get().commit(replaceObjectInScene(project, selectActiveScope(s), cur));
    get().selectObject(id);
  },
  setGroupTransform(id, partial) {
    const s = get();
    const obj = selectActiveObjects(s).find((o) => o.id === id);
    if (!obj || !obj.isGroup) return;
    get().commit(replaceObjectInScene(s.history.present, selectActiveScope(s), { ...obj, base: { ...obj.base, ...partial } }));
  },
  selectObjectOrGroup(id) {
    get().selectObject(resolveToEntity(selectActiveObjects(get()), id));
  },
  toggleObjectOrGroup(id) {
    const e = resolveToEntity(selectActiveObjects(get()), id);
    const cur = get().selectedObjectIds;
    get().selectObjects(cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]);
  },
  selectObjectsExpandingGroups(ids) {
    get().selectObjects(expandToGroups(selectActiveObjects(get()), ids));
  },
  enterShapeBuilder() {
    const s = get();
    const project = s.history.present;
    const activeObjects = selectActiveObjects(s);
    const ids = s.selectedObjectIds;
    const lockById = new Map(activeObjects.map((o) => [o.id, o]));
    const eligible =
      ids.length >= 2 &&
      ids.length <= 6 &&
      ids.every((id) => {
        const o = activeObjects.find((x) => x.id === id);
        return !!o && isShapeBuilderEligible(o, project, activeObjects, lockById);
      });
    if (!eligible) {
      get().pushToast('error', 'Select 2-6 plain closed shapes for Shape Builder.');
      return;
    }
    set({ shapeBuilder: { ids: [...ids] } });
  },
  exitShapeBuilder() {
    if (!get().shapeBuilder) return;
    set({ shapeBuilder: null });
  },
  shapeBuilderMerge(contributorIds) {
    const s = get();
    if (!s.shapeBuilder) return; // gestures only target the frozen ids while the mode is active
    if (contributorIds.length < 2) return; // nothing to merge (size-1 regions are inert on click)
    const project = s.history.present;
    const activeScope = selectActiveScope(s);
    const scopeObjects = selectActiveObjects(s);
    const time = snapToFrame(s.time, project.meta.fps); // mirrors booleanOp's own time semantics
    const operands = contributorIds
      .map((id) => scopeObjects.find((o) => o.id === id))
      .filter((o): o is SceneObject => !!o);
    if (operands.length < 2) return;
    const rings = booleanOpEngine({ ...project, objects: scopeObjects }, operands, 'union', time);
    if (rings.length === 0) return; // empty/degenerate -> no-op

    const { project: nextProject, obj } = applyBooleanResult(project, scopeObjects, activeScope, operands, rings, 'union');
    get().commit(nextProject);
    // Splice the frozen ids (NOT the live selection — design decision 1: "selection is left alone
    // during the mode"): the merged result replaces its contributors.
    const contributorSet = new Set(contributorIds);
    const nextIds = [...s.shapeBuilder.ids.filter((id) => !contributorSet.has(id)), obj.id];
    // Auto-exit once fewer than 2 frozen operands remain (design doc decision 1, "after a merge").
    set({ shapeBuilder: nextIds.length < 2 ? null : { ids: nextIds } });
  },
  shapeBuilderPunch(regionRings, contributorIds) {
    const s = get();
    if (!s.shapeBuilder) return;
    if (contributorIds.length === 0 || regionRings.length === 0) return;
    const project = s.history.present;
    const activeScope = selectActiveScope(s);
    const scopeObjects = selectActiveObjects(s);
    const time = snapToFrame(s.time, project.meta.fps);
    // Scoped like every other engine call this slice makes (e.g. booleanOp's `{ ...project,
    // objects: activeObjects }`) so `objectToWorldPolygon`'s group-ancestor walk resolves WITHIN
    // the active scope (root or an edited symbol) — `regionRings` are assumed to already be in
    // that SAME "world" (the active scope's own root space, per objectToWorldPolygon's convention).
    const scopedProject = { ...project, objects: scopeObjects };

    // regionRings (a flat, possibly multi-ring PathData[] — decomposeRegions' convention) -> ONE
    // coherent PcMultiPolygon: each input ring becomes its own single-ring Polygon, unioned by
    // `pc` itself (mirrors operandWorldGeom's SVG multi-ring precedent in boolean.ts, which
    // resolves hole-nesting/disjoint pieces via pc.union rather than guessing at ring nesting).
    const regionRingPolys = regionRings.map((r) => [pathDataToPcRing(r)]);
    const regionPoly =
      regionRingPolys.length === 1 ? regionRingPolys[0] : pc.union(regionRingPolys[0], ...regionRingPolys.slice(1));

    const objectUpdates = new Map<string, SceneObject>();
    const assetUpdates = new Map<string, VectorAsset>();
    const removedIds = new Set<string>();
    let anyTrimOrDashDropped = false;

    for (const id of contributorIds) {
      const obj = scopeObjects.find((o) => o.id === id);
      if (!obj) continue;
      const asset = project.assets.find((a) => a.id === obj.assetId);
      if (!asset || asset.kind !== 'vector') continue;

      // pc.difference(contributorWorldPoly, regionPoly) (spec decision 5) — world space, matching
      // the region math; write-back inverts back to LOCAL below (worldPointToLocal).
      const contributorPoly = objectToWorldPolygon(scopedProject, obj, time);
      if (contributorPoly.length === 0) continue; // no usable geometry — leave untouched
      const diffRings = pc
        .difference(contributorPoly, regionPoly)
        .flat()
        .map(pcRingToPathData)
        .filter((p) => p.nodes.length >= 3);

      if (diffRings.length === 0) {
        removedIds.add(id); // fully punched away
        continue;
      }

      // Same anchor resolution objectToWorldPolygon used above, so worldPointToLocal inverts the
      // EXACT chain that produced contributorPoly (round-trips exactly on an unpunched contributor).
      const state = sampleObject(obj, time);
      const box = asset.shapeType === 'path' ? pathBounds(state.path ?? asset.path ?? { nodes: [], closed: false }) : undefined;
      const { anchorX, anchorY } = resolveAnchor(obj, state, asset.shapeType, box);
      const localRings = diffRings.map((r) => ({
        closed: true,
        nodes: r.nodes.map((n) => ({ anchor: worldPointToLocal(scopeObjects, obj, anchorX, anchorY, n.anchor, time) })),
      }));
      const sorted = localRings
        .slice()
        .sort((a, b) => Math.abs(ringArea(b.nodes.map((n) => n.anchor))) - Math.abs(ringArea(a.nodes.map((n) => n.anchor))));
      const primary = sorted[0];
      const compoundRings = sorted.slice(1);

      if (obj.trim || obj.dashOffsetTrack) anyTrimOrDashDropped = true;

      // Byte-clean compoundRings (never leak a stale pre-punch compoundRings/primitive spec) +
      // primitive-detach (mirrors setPathData's `{ ...asset, path, primitive: undefined }`) +
      // shapeType-detach (a punched rect/ellipse becomes a free path — new for punch: no prior
      // codepath converts a primitive shapeType into 'path' in place).
      assetUpdates.set(asset.id, {
        ...omitCompoundRings(asset),
        shapeType: 'path',
        path: primary,
        primitive: undefined,
        ...(compoundRings.length > 0 ? { compoundRings } : {}),
      });
      objectUpdates.set(id, { ...dropTrimAndDash(obj), tracks: omitPrimitiveTracks(obj.tracks) });
    }

    if (objectUpdates.size === 0 && removedIds.size === 0) return; // nothing overlapped — silent no-op

    const nextAssets = project.assets.map((a) => assetUpdates.get(a.id) ?? a);
    const nextObjects = scopeObjects.filter((o) => !removedIds.has(o.id)).map((o) => objectUpdates.get(o.id) ?? o);

    let nextProject = withSceneObjects({ ...project, assets: nextAssets }, activeScope, nextObjects);
    if (removedIds.size > 0) {
      // Cross-scene, symbol-preserving prune of the now-orphaned SOURCE assets (booleanOp/deleteSymbol
      // precedent): keep an asset if still referenced anywhere; never prune symbol/audio.
      const candidateAssetIds = new Set(scopeObjects.filter((o) => removedIds.has(o.id)).map((o) => o.assetId));
      const referenced = collectReferencedAssetIds(nextProject);
      nextProject = {
        ...nextProject,
        assets: nextProject.assets.filter((a) => {
          if (!candidateAssetIds.has(a.id)) return true;
          if (a.kind === 'symbol' || a.kind === 'audio') return true;
          return referenced.has(a.id);
        }),
      };
    }

    get().commit(nextProject);
    // Scissors precedent (cutSelectedPathAt): one shared info toast for the whole gesture, not one
    // per contributor.
    if (anyTrimOrDashDropped) get().pushToast('info', 'Trim/dash animation removed — path re-parameterized.');
    // Drop removed contributors from the frozen ids. Per the design doc (decision 1), auto-exit is
    // specified only "after a merge" — punch just trims the ids list (a surviving contributor stays
    // a valid future click target; the mode itself only ends via Escape/toggle or a later merge).
    const remainingIds = s.shapeBuilder.ids.filter((id) => !removedIds.has(id));
    set({ shapeBuilder: { ids: remainingIds } });
  },
});
