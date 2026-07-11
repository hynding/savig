// Text-on-path (text-on-path #1): resolves a text SceneObject's `textPath` binding to the
// bound path object's CURRENT-FRAME geometry, mapped into world/scene space, plus the
// current animated/static startOffset. Cross-object resolution lives here (not inside
// sampleObject) — same project-scope seam as geom/boolean.ts's boolean-operand resolution
// (`objectToWorldPolygon`/`toWorld`), which this module mirrors for the transform chain.
import { interpolate } from './interpolate';
import { pathToD, pathBounds } from './path';
import { sampleObject, resolveAnchor, type RenderState } from './sample';
import { parentGroupOf, mapPoint } from './groupTransform';
import type { PathData, PathNode, PathPoint, Project, SceneObject } from './types';

export interface ResolvedTextPath {
  /** The bound path's current-frame PathData, mapped through its FULL composed world
   *  transform chain (own transform + every group ancestor), serialized to an SVG `d`. */
  worldD: string;
  /** pathLength-normalized (0..1 nominal) startOffset for the current frame. Track-wins over
   *  the static base; NOT clamped/wrapped — out-of-range values pass through raw (browsers
   *  handle out-of-range startOffset on a pathLength="1" def). */
  startOffset: number;
}

/** One link in a world-transform chain: a sampled Transform2D-ish state plus the anchor
 *  (pivot) it rotates/scales about, as consumed by groupTransform's `mapPoint`. */
interface ChainLink {
  state: RenderState;
  ax: number;
  ay: number;
}

/** The target object's own transform, then every group ancestor outermost-last (mapPoint
 *  composition order — innermost/object's own transform applied FIRST), so a point can be
 *  mapped through the whole chain by folding `mapPoint` over the array in order. Mirrors
 *  geom/boolean.ts's unexported `toWorld` (same `mapPoint` + `parentGroupOf` composition) —
 *  kept as a local mirror rather than importing across the geom/ boundary (the `regions.ts`
 *  precedent for local-mirroring un-exported geom internals), and hoists the per-frame
 *  sampling of each chain link OUTSIDE the per-node point loop below (toWorld re-samples
 *  per point; here every node/handle of the same target reuses one chain). */
function worldChain(project: Project, obj: SceneObject, ax: number, ay: number, time: number): ChainLink[] {
  const chain: ChainLink[] = [{ state: sampleObject(obj, time), ax, ay }];
  let cur = parentGroupOf(project.objects, obj);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push({ state: sampleObject(cur, time), ax: cur.anchorX, ay: cur.anchorY });
    cur = parentGroupOf(project.objects, cur);
  }
  return chain;
}

function applyChain(chain: ChainLink[], p: PathPoint): PathPoint {
  let q = p;
  for (const link of chain) {
    q = mapPoint(link.state, link.ax, link.ay, q.x, q.y);
  }
  return q;
}

/** Transform one PathNode through the world chain. Handles (`in`/`out`) are ANCHOR-RELATIVE
 *  OFFSETS, not absolute points: mapping them naively as points (as if they were their own
 *  anchor) would apply the chain's TRANSLATION to the offset too, which is wrong. Each chain
 *  link is affine (mapPoint = translate + rotate + scale) and composition of affine maps is
 *  affine (world(p) = A·p + b for some fixed A,b), so:
 *    world(anchor + offset) - world(anchor) = (A·anchor + A·offset + b) - (A·anchor + b) = A·offset
 *  — i.e. transforming the ABSOLUTE point (anchor+offset) and subtracting the transformed
 *  anchor gives exactly the rotated/scaled (never translated) handle offset, correct for the
 *  WHOLE composed chain (not just a single rotation/scale level). Hand-verified with a
 *  rotated+scaled target in textPath.test.ts. */
function transformNode(chain: ChainLink[], n: PathNode): PathNode {
  const worldAnchor = applyChain(chain, n.anchor);
  const node: PathNode = { anchor: worldAnchor };
  if (n.in) {
    const worldAbs = applyChain(chain, { x: n.anchor.x + n.in.x, y: n.anchor.y + n.in.y });
    node.in = { x: worldAbs.x - worldAnchor.x, y: worldAbs.y - worldAnchor.y };
  }
  if (n.out) {
    const worldAbs = applyChain(chain, { x: n.anchor.x + n.out.x, y: n.anchor.y + n.out.y });
    node.out = { x: worldAbs.x - worldAnchor.x, y: worldAbs.y - worldAnchor.y };
  }
  return node;
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

  const worldPath: PathData = { nodes: path.nodes.map((n) => transformNode(chain, n)), closed: path.closed };
  const worldD = pathToD(worldPath);

  const offsetTrack = textObj.tracks.textPathOffset;
  const startOffset = offsetTrack && offsetTrack.length > 0 ? interpolate(offsetTrack, time) : tp.startOffset;

  return { worldD, startOffset };
}
