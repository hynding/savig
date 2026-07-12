// Text-on-path (text-on-path #1): resolves a text SceneObject's `textPath` binding to the
// bound path object's CURRENT-FRAME geometry, mapped into world/scene space, plus the
// current animated/static startOffset. Cross-object resolution lives here (not inside
// sampleObject) — same project-scope seam as geom/boolean.ts's boolean-operand resolution
// (`objectToWorldPolygon`/`toWorld`), which this module mirrors for the transform chain.
import { interpolate } from './interpolate';
import { pathToD, pathBounds } from './path';
import { sampleObject, resolveAnchor } from './sample';
import { worldChain, worldTransformNode } from './groupTransform';
import type { Asset, PathData, Project, SceneObject, SymbolAsset } from './types';

export interface ResolvedTextPath {
  /** The bound path's current-frame PathData, mapped through its FULL composed world
   *  transform chain (own transform + every group ancestor), serialized to an SVG `d`. */
  worldD: string;
  /** pathLength-normalized (0..1 nominal) startOffset for the current frame. Track-wins over
   *  the static base; NOT clamped/wrapped — out-of-range values pass through raw (browsers
   *  handle out-of-range startOffset on a pathLength="1" def). */
  startOffset: number;
}

/**
 * Resolves `textObj.textPath` against `project` at `time`. Returns `null` (fallback to plain
 * `<text>`, lazy-degradation — boolean-operand precedent) unless:
 *   - `textObj.textPath` is set,
 *   - the target resolves in `project.objects`,
 *   - the target's asset is a vector `shapeType: 'path'`,
 *   - the target has NO `obj.boolean` (a live-boolean-bound path is out of scope v1 — its
 *     rendered geometry would need `resolveBooleanRings`; documented deferral, not a bug).
 */
export function resolveTextPath(project: Project, textObj: SceneObject, time: number): ResolvedTextPath | null {
  const tp = textObj.textPath;
  if (!tp) return null;

  const target = project.objects.find((o) => o.id === tp.pathObjectId);
  if (!target) return null;
  if (target.boolean) return null; // v1 fallback: live-boolean targets (see doc comment above)

  const asset = project.assets.find((a) => a.id === target.assetId);
  if (!asset || asset.kind !== 'vector' || asset.shapeType !== 'path') return null;

  const state = sampleObject(target, time, asset.primitive);
  const path: PathData | undefined = state.path ?? asset.path;
  if (!path || path.nodes.length === 0) return null;

  const box = pathBounds(path);
  const { anchorX, anchorY } = resolveAnchor(target, state, 'path', box);
  const chain = worldChain(project, target, anchorX, anchorY, time);

  const worldPath: PathData = { nodes: path.nodes.map((n) => worldTransformNode(chain, n)), closed: path.closed };
  const worldD = pathToD(worldPath);

  const offsetTrack = textObj.tracks.textPathOffset;
  const startOffset = offsetTrack && offsetTrack.length > 0 ? interpolate(offsetTrack, time) : tp.startOffset;

  return { worldD, startOffset };
}

/** Returns true iff any object in `asset`'s subtree (descending into nested SYMBOL assets) has
 *  a `.textPath` binding. Mirrors `isStaticSymbol`'s shape exactly (packages/engine/src/
 *  duration.ts:89-104): a cycle-guarded recursive walk over `asset.objects`, following nested
 *  symbol instances via `assetsById`.
 *
 *  Used by the services export layer (Task 2, text-on-path final review) to exclude
 *  bound-text symbols from the static-`<use>` optimization: `buildStaticSymbolDef` builds a
 *  symbol-LOCAL project (`{ ...project, objects: asset.objects }`), so `resolveTextPath`
 *  resolves symbol-local bindings inside a static def — while the editor Stage and the runtime
 *  both sample with a ROOT-scoped project, fail the lookup, and degrade to plain `<text>`.
 *  Gating export on `symbolHasBoundText` keeps the static-def path and the full-inlining path
 *  (which uses the root project, matching editor/runtime) in sync. Deliberately NOT folded into
 *  `isStaticSymbol` itself — that function is duration semantics; this is an export-optimization
 *  concern, so the gate is applied at the `buildStaticOptimizableMap` call site instead. */
export function symbolHasBoundText(
  asset: SymbolAsset,
  assetsById: Map<string, Asset>,
  visited = new Set<string>(),
): boolean {
  if (visited.has(asset.id)) return false; // cycle: no NEW bound text found by re-entering
  const next = new Set(visited);
  next.add(asset.id);
  for (const obj of asset.objects) {
    if (obj.textPath && !obj.hidden) return true;
    if (!obj.isGroup && !obj.hidden) {
      const child = assetsById.get(obj.assetId);
      if (child && child.kind === 'symbol') {
        if (symbolHasBoundText(child, assetsById, next)) return true;
      }
    }
  }
  return false;
}
