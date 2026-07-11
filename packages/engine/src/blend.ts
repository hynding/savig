// Blend (art-tools #9): Illustrator-style blend between two vector paths. Given two path
// SceneObjects, produces `count` intermediate PathData+VectorStyle+opacity snapshots
// interpolating A -> B in SCOPE-WORLD space. Pure engine core — no store/selection/undo
// knowledge (computeOutlineStrokeEffect precedent); called by BOTH the editor-state store
// action and the DSL builder so the blend geometry/style math is never duplicated.
//
// EDITOR-ONLY: this module must never be imported from packages/runtime/src (it is not
// reachable from a static export/preview render — a blend is a static generate-once
// command, not a per-frame render path). It transitively reuses path.ts (already in the
// runtime bundle via samplePath) only for the newly-exported lerpNode/lerpPoint — no new
// runtime-bundle surface of its own; regen-and-diff verifies this per commit.
import { applyEasing } from './easing';
import { interpolateColor, parseHex } from './color';
import { interpolateGradient } from './gradientAnim';
import { lerpNode, pathBounds } from './path';
import { reconcile } from './morph/reconcile';
import { suggestCorrespondence } from './morph/suggest';
import { sampleObject, resolveAnchor, type RenderState } from './sample';
import { worldChain, worldTransformNode } from './groupTransform';
import type { Easing, Gradient, PathData, Project, SceneObject, VectorAsset, VectorStyle } from './types';

export interface BlendStep {
  /** SCOPE-WORLD coordinates (mapped through the source objects' full parent-chain
   *  transform, like resolveTextPath's worldD) — callers normalize/place. `closed` is held
   *  from A (reconcile precedent; no midpoint flip). */
  path: PathData;
  /** A fresh VectorStyle (no shared references with either source asset's style).
   *  fill/stroke/gradients/strokeWidth interpolate; strokeLinecap/strokeLinejoin hold from A
   *  — see computeStyleStep's doc comment for which fields are deliberately excluded and
   *  why. */
  style: VectorStyle;
  opacity: number;
}

/** One fully-resolved blend endpoint: its vector asset, its PathData baked into
 *  scope-world space at `time`, and the sampled per-frame render state (source of the
 *  animated fill/stroke/fillGradient/strokeGradient/opacity overlay). */
interface BlendSource {
  asset: VectorAsset;
  worldPath: PathData;
  state: RenderState;
}

/** Resolves one blend operand. Returns null (caller-visible ineligibility, per
 *  computeBlendSteps' contract) unless `obj`:
 *   - is not a live-boolean node (`obj.boolean` — the boolean-operand precedent: a
 *     live-clipped path isn't a static shape to blend from),
 *   - has no `shapeTrack` (already morphing — a blend source must be a plain static shape,
 *     structural-op precedent),
 *   - references a vector asset with `shapeType === 'path'`,
 *   - that asset has no `compoundRings` (morph/blend machinery is single-ring — the
 *     cutPath/outline "release compound shapes" precedent),
 *   - and resolves a non-empty path (sampled shapeTrack/primitive-regenerated path, else
 *     the static asset path — sample.ts / resolveTextPath precedent).
 * LOCK and operand/selection-count checks are NOT here — those are the store's job (the
 * plan's explicit scope-blind contract); this function only enforces the ASSET-side rules. */
function resolveBlendSource(project: Project, obj: SceneObject, time: number): BlendSource | null {
  if (obj.boolean) return null;
  if (obj.shapeTrack && obj.shapeTrack.length > 0) return null;

  const asset = project.assets.find((a) => a.id === obj.assetId);
  if (!asset || asset.kind !== 'vector' || asset.shapeType !== 'path') return null;
  if (asset.compoundRings && asset.compoundRings.length > 0) return null;

  const state = sampleObject(obj, time, asset.primitive);
  const path = state.path ?? asset.path;
  if (!path || path.nodes.length === 0) return null;

  const box = pathBounds(path);
  const { anchorX, anchorY } = resolveAnchor(obj, state, 'path', box);
  const chain = worldChain(project, obj, anchorX, anchorY, time);
  const worldPath: PathData = { nodes: path.nodes.map((n) => worldTransformNode(chain, n)), closed: path.closed };

  return { asset, worldPath, state };
}

/** A blend operand's effective paint, overlaying its per-frame sampled fill/stroke/gradient
 *  state onto its asset's static VectorStyle (an absent sampled field means "no animated
 *  override" — the same overlay rule as editor-state's captureStyle / geom/strokeOutline's
 *  WYSIWYG-fill comment: a live recolor wins over the static base). strokeWidth,
 *  strokeLinecap and strokeLinejoin have no track (not in ANIMATABLE_PROPERTIES) so they are
 *  always the static asset value. */
interface EffectivePaint {
  fill: string;
  fillGradient?: Gradient;
  stroke: string;
  strokeGradient?: Gradient;
  strokeWidth: number;
  strokeLinecap?: VectorStyle['strokeLinecap'];
  strokeLinejoin?: VectorStyle['strokeLinejoin'];
}

function effectivePaint(source: BlendSource): EffectivePaint {
  const { state, asset } = source;
  return {
    fill: state.fill ?? asset.style.fill,
    fillGradient: state.fillGradient ?? asset.style.fillGradient,
    stroke: state.stroke ?? asset.style.stroke,
    strokeGradient: state.strokeGradient ?? asset.style.strokeGradient,
    strokeWidth: asset.style.strokeWidth,
    strokeLinecap: asset.style.strokeLinecap,
    strokeLinejoin: asset.style.strokeLinejoin,
  };
}

interface PaintSlot {
  color: string;
  gradient?: Gradient;
}

/**
 * One paint slot's (fill or stroke) blend rule:
 *   - BOTH sides are gradients -> interpolateGradient (its own type-mismatch/stop-count
 *     reconciliation applies transparently).
 *   - BOTH sides are parseable solid colors (no gradient, `parseHex` succeeds — excludes
 *     'none' and any unparseable value) -> interpolateColor.
 *   - ANY OTHER kind mismatch (solid<->gradient, 'none'<->paint, one side unparseable) ->
 *     STEP holding A's whole slot (color + gradient) until t >= 1, then B's — the
 *     interpolateGradient type-mismatch convention, generalized to the slot level so a
 *     paint kind never gets a nonsensical mid-blend value.
 */
function lerpPaintSlot(a: PaintSlot, b: PaintSlot, t: number): PaintSlot {
  if (a.gradient && b.gradient) {
    return { color: t >= 1 ? b.color : a.color, gradient: interpolateGradient(a.gradient, b.gradient, t) };
  }
  const aSolid = !a.gradient && parseHex(a.color) !== null;
  const bSolid = !b.gradient && parseHex(b.color) !== null;
  if (aSolid && bSolid) {
    return { color: interpolateColor(a.color, b.color, t) };
  }
  return t >= 1 ? { color: b.color, gradient: b.gradient } : { color: a.color, gradient: a.gradient };
}

/**
 * Builds ONE intermediate's VectorStyle at progress `t`. A fresh object every call (no
 * shared references with either source asset's style — required so later edits to an
 * intermediate never mutate A/B). fill/stroke/fillGradient/strokeGradient/strokeWidth
 * interpolate; `strokeLinecap`/`strokeLinejoin` are HELD FROM A (conditional-spread — absent
 * on A stays absent on the intermediate, no invented default); `strokeDasharray`/
 * `strokeDashoffset` are NOT copied. Dash/dashoffset are explicitly out (dash windows are
 * pathLength-relative to a SPECIFIC path, meaningless once re-parameterized by
 * reconcile/resample — the strokeOutline.ts "repurposes the paint channel" precedent for why
 * paint-adjacent-but-not-paint fields don't survive a geometry rewrite). linecap/linejoin
 * ARE cosmetic but geometry-independent (unlike dash, they don't reference path length), and
 * omitting them entirely made two round-capped strokes blend through a visible butt/miter
 * seam at every intermediate — so they hold from A rather than falling back to the SVG
 * defaults (see task-4-report.md fix wave).
 */
function computeStyleStep(a: EffectivePaint, b: EffectivePaint, t: number): VectorStyle {
  const fill = lerpPaintSlot({ color: a.fill, gradient: a.fillGradient }, { color: b.fill, gradient: b.fillGradient }, t);
  const stroke = lerpPaintSlot(
    { color: a.stroke, gradient: a.strokeGradient },
    { color: b.stroke, gradient: b.strokeGradient },
    t,
  );
  return {
    fill: fill.color,
    stroke: stroke.color,
    strokeWidth: a.strokeWidth + (b.strokeWidth - a.strokeWidth) * t,
    ...(fill.gradient ? { fillGradient: fill.gradient } : {}),
    ...(stroke.gradient ? { strokeGradient: stroke.gradient } : {}),
    ...(a.strokeLinecap ? { strokeLinecap: a.strokeLinecap } : {}),
    ...(a.strokeLinejoin ? { strokeLinejoin: a.strokeLinejoin } : {}),
  };
}

/**
 * Computes `opts.count` intermediate blend steps between `objA` and `objB`, world-space
 * (both objects sampled at `opts.time ?? 0` and mapped through their full parent-chain
 * transform — see `resolveBlendSource`/`worldChain`). Returns null when either object fails
 * the ASSET-side eligibility rules (not a vector path, empty path, compoundRings,
 * live-boolean, shapeTrack) or when `opts.count < 1`. Scope-/selection-blind: lock state and
 * "is this a valid two-object selection" are the STORE's job, not this function's.
 *
 * Correspondence: equal source node counts reconcile 'corresponded' (rotation/winding-
 * minimizing `suggestCorrespondence`, handle-preserving `lerpNode`); unequal counts
 * reconcile 'resampled' (64-point arc-length resample + align — loses bezier handles,
 * documented cross-shape-morph precedent). Result `closed` is held from A.
 *
 * Intermediate i of `count` (1-indexed, i = 1..count) uses
 * `t = applyEasing(opts.easing ?? 'linear', i / (count + 1))` — endpoints (t=0, t=1) are
 * deliberately excluded since A and B already exist on canvas as their own objects.
 */
export function computeBlendSteps(
  project: Project,
  objA: SceneObject,
  objB: SceneObject,
  opts: { count: number; easing?: Easing; time?: number },
): BlendStep[] | null {
  if (opts.count < 1) return null;
  const time = opts.time ?? 0;
  const easing: Easing = opts.easing ?? 'linear';

  const a = resolveBlendSource(project, objA, time);
  const b = resolveBlendSource(project, objB, time);
  if (!a || !b) return null;

  const { an, bn } =
    a.worldPath.nodes.length === b.worldPath.nodes.length
      ? reconcile(a.worldPath, b.worldPath, 'corresponded', suggestCorrespondence(a.worldPath, b.worldPath))
      : reconcile(a.worldPath, b.worldPath, 'resampled');
  const closed = a.worldPath.closed;

  const aPaint = effectivePaint(a);
  const bPaint = effectivePaint(b);
  const aOpacity = a.state.opacity;
  const bOpacity = b.state.opacity;

  const steps: BlendStep[] = [];
  for (let i = 1; i <= opts.count; i++) {
    const t = applyEasing(easing, i / (opts.count + 1));
    const nodes = an.map((na, k) => lerpNode(na, bn[k], t));
    steps.push({
      path: { nodes, closed },
      style: computeStyleStep(aPaint, bPaint, t),
      opacity: aOpacity + (bOpacity - aOpacity) * t,
    });
  }
  return steps;
}
