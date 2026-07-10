import { interpolate } from './interpolate';
import { samplePath } from './path';
import { sampleColor } from './color';
import { sampleGradient } from './gradientAnim';
import { pointAtFraction, tangentAngleDeg } from './motion';
import { ANIMATABLE_PROPERTIES, GEOMETRY_PROPERTIES } from './project';
import type {
  AnimatableProperty,
  Gradient,
  PathData,
  Project,
  ResolvedGeometry,
  SceneObject,
  Transform2D,
  TrimValues,
  VectorShapeType,
} from './types';

export interface RenderState extends Transform2D {
  objectId: string;
  /** Present only for vector objects that have geometry. */
  geometry?: ResolvedGeometry;
  /** Present only for path objects that have a shapeTrack (morphing). */
  path?: PathData;
  /** Present only for vector objects with an animated fill/stroke color track. */
  fill?: string;
  stroke?: string;
  /** Present only for vector objects with an animated fill/stroke gradient track. */
  fillGradient?: Gradient;
  strokeGradient?: Gradient;
  /** Present only for vector objects with an animated stroke-dashoffset track. */
  strokeDashoffset?: number;
  /** Present only for vector objects with a trim path (sampled start/end/offset). */
  trim?: TrimValues;
}

export function sampleObject(obj: SceneObject, time: number): RenderState {
  const resolve = (prop: AnimatableProperty, fallback: number): number => {
    const track = obj.tracks[prop];
    if (track && track.length > 0) {
      return interpolate(track, time, prop === 'rotation');
    }
    return fallback;
  };

  const state = { objectId: obj.id } as RenderState;
  for (const prop of ANIMATABLE_PROPERTIES) {
    state[prop] = resolve(prop, obj.base[prop]);
  }

  const geometry: ResolvedGeometry = {};
  for (const prop of GEOMETRY_PROPERTIES) {
    const hasTrack = (obj.tracks[prop]?.length ?? 0) > 0;
    const baseValue = obj.shapeBase?.[prop];
    if (hasTrack || baseValue !== undefined) {
      geometry[prop] = resolve(prop, baseValue ?? 0);
    }
  }
  if (Object.keys(geometry).length > 0) {
    state.geometry = geometry;
  }
  if (obj.shapeTrack && obj.shapeTrack.length > 0) {
    state.path = samplePath(obj.shapeTrack, time);
  }
  if (obj.colorTracks) {
    for (const prop of ['fill', 'stroke'] as const) {
      const track = obj.colorTracks[prop];
      if (track && track.length > 0) state[prop] = sampleColor(track, time);
    }
  }
  if (obj.gradientTracks) {
    const fillTrack = obj.gradientTracks.fill;
    if (fillTrack && fillTrack.length > 0) state.fillGradient = sampleGradient(fillTrack, time);
    const strokeTrack = obj.gradientTracks.stroke;
    if (strokeTrack && strokeTrack.length > 0) state.strokeGradient = sampleGradient(strokeTrack, time);
  }
  if (obj.dashOffsetTrack && obj.dashOffsetTrack.length > 0) {
    state.strokeDashoffset = interpolate(obj.dashOffsetTrack, time);
  }
  if (obj.trim) {
    const tr = obj.trim;
    const component = (track: typeof tr.startTrack, base: number): number =>
      track && track.length > 0 ? interpolate(track, time) : base;
    state.trim = {
      start: component(tr.startTrack, tr.start),
      end: component(tr.endTrack, tr.end),
      offset: component(tr.offsetTrack, tr.offset),
    };
  }
  // Motion path overrides the resolved translation (and rotation when orienting):
  // the object follows the guide at the eased progress. Gated on a non-empty progress
  // track so a guide drawn-but-not-paced is a no-op. Scale/opacity/geometry/color stand.
  const mp = obj.motionPath;
  if (mp && mp.progress.length > 0) {
    const frac = interpolate(mp.progress, time);
    const p = pointAtFraction(mp.path, frac);
    state.x = p.x;
    state.y = p.y;
    if (mp.orient) {
      state.rotation = tangentAngleDeg(mp.path, frac) + obj.base.rotation;
    }
  }
  return state;
}

// Resolves the absolute rotate/scale pivot. Vector objects store the anchor as a
// fraction of the bbox and resolve it against the per-frame geometry so the pivot
// stays centered as the shape's size animates; imported SVGs keep absolute anchors.
export function resolveAnchor(
  obj: SceneObject,
  state: RenderState,
  shapeType: VectorShapeType | undefined,
  pathBox?: { x: number; y: number; width: number; height: number },
): { anchorX: number; anchorY: number } {
  if (obj.anchorMode !== 'fraction') {
    return { anchorX: obj.anchorX, anchorY: obj.anchorY };
  }
  if (shapeType === 'path') {
    const box = pathBox ?? { x: 0, y: 0, width: 0, height: 0 };
    return {
      anchorX: box.x + obj.anchorX * box.width,
      anchorY: box.y + obj.anchorY * box.height,
    };
  }
  const g = state.geometry ?? {};
  const width = shapeType === 'ellipse' ? 2 * (g.radiusX ?? 0) : g.width ?? 0;
  const height = shapeType === 'ellipse' ? 2 * (g.radiusY ?? 0) : g.height ?? 0;
  return { anchorX: obj.anchorX * width, anchorY: obj.anchorY * height };
}

export function sampleProject(project: Project, time: number): RenderState[] {
  return project.objects
    .map((obj, index) => ({ obj, index }))
    .sort((p, q) => p.obj.zOrder - q.obj.zOrder || p.index - q.index)
    .map(({ obj }) => sampleObject(obj, time));
}
