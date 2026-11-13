// Shape tween between frame-layer keys (spec 2026-11-13-shape-tween-design.md). Approach A,
// "bake": key A's tweenable drawings become path objects whose shapeTrack / colorTracks /
// opacity track run from A's shape at A.time to B's shape at B.time. Every renderer already
// morphs a path inside a key and exposes it only for the key's span, so a tween needs no new
// render code and keeps preview == export. The key records `tween` so the editor can show,
// update and remove it.

import { parseHex } from './color';
import { frameKeySpans } from './frameLayer';
import { pathBounds } from './path';
import { createVectorAsset, newId } from './project';
import { mapPoint } from './groupTransform';
import { resolveAnchor, sampleObject } from './sample';
import type {
  Asset,
  ColorKeyframe,
  Easing,
  FrameKey,
  PathData,
  PathNode,
  PathPoint,
  SceneObject,
  ShapeKeyframe,
  ShapeTween,
  VectorAsset,
} from './types';

const KAPPA = 0.5522847498; // as geom/boolean (a quarter-circle cubic)

export interface TweenBakeResult {
  objects: SceneObject[];
  assets: Asset[];
  tween: ShapeTween;
}

const vectorAssetOf = (assets: Asset[], obj: SceneObject): VectorAsset | undefined => {
  const a = assets.find((x) => x.id === obj.assetId);
  return a && a.kind === 'vector' ? a : undefined;
};

/** A drawing a shape tween can morph: a visible, non-mask vector rect / ellipse / single-ring
 *  path leaf that is not a live boolean. Text, svg, symbols, groups and compound paths hold. */
export function tweenableDrawing(obj: SceneObject, asset: Asset | undefined): asset is VectorAsset {
  if (!asset || asset.kind !== 'vector') return false;
  if (obj.isGroup || obj.boolean || obj.hidden || obj.isMask) return false;
  if (asset.compoundRings && asset.compoundRings.length > 0) return false;
  if (asset.shapeType === 'path') return !!(obj.shapeTrack?.length || asset.path || asset.primitive);
  return true;
}

const add = (a: PathPoint, b: PathPoint): PathPoint => ({ x: a.x + b.x, y: a.y + b.y });

/** Rect outline in the drawing's own frame: 4 corners, or 8 nodes with kappa arcs when the
 *  rect has corner radius (SVG clamps rx to half of each side). */
function rectNodes(w: number, h: number, r: number): PathNode[] {
  const rr = Math.min(Math.max(0, r), w / 2, h / 2);
  if (rr <= 0) {
    return [{ anchor: { x: 0, y: 0 } }, { anchor: { x: w, y: 0 } }, { anchor: { x: w, y: h } }, { anchor: { x: 0, y: h } }];
  }
  const k = KAPPA * rr;
  return [
    { anchor: { x: rr, y: 0 }, in: { x: -k, y: 0 } },
    { anchor: { x: w - rr, y: 0 }, out: { x: k, y: 0 } },
    { anchor: { x: w, y: rr }, in: { x: 0, y: -k } },
    { anchor: { x: w, y: h - rr }, out: { x: 0, y: k } },
    { anchor: { x: w - rr, y: h }, in: { x: k, y: 0 } },
    { anchor: { x: rr, y: h }, out: { x: -k, y: 0 } },
    { anchor: { x: 0, y: h - rr }, in: { x: 0, y: k } },
    { anchor: { x: 0, y: rr }, out: { x: 0, y: -k } },
  ];
}

/** Ellipse outline (centre (rx, ry), matching geometryToSvgAttrs): 4 kappa cubics. */
function ellipseNodes(rx: number, ry: number): PathNode[] {
  const kx = KAPPA * rx;
  const ky = KAPPA * ry;
  return [
    { anchor: { x: 2 * rx, y: ry }, in: { x: 0, y: -ky }, out: { x: 0, y: ky } },
    { anchor: { x: rx, y: 2 * ry }, in: { x: kx, y: 0 }, out: { x: -kx, y: 0 } },
    { anchor: { x: 0, y: ry }, in: { x: 0, y: ky }, out: { x: 0, y: -ky } },
    { anchor: { x: rx, y: 0 }, in: { x: -kx, y: 0 }, out: { x: kx, y: 0 } },
  ];
}

function ownPath(obj: SceneObject, asset: VectorAsset, time: number): PathData | null {
  const state = sampleObject(obj, time, asset.primitive);
  if (asset.shapeType === 'path') {
    const p = state.path ?? asset.path;
    return p && p.nodes.length >= 2 ? p : null;
  }
  const g = state.geometry ?? {};
  if (asset.shapeType === 'rect') {
    const w = Math.max(0, g.width ?? 0);
    const h = Math.max(0, g.height ?? 0);
    return w > 0 && h > 0 ? { nodes: rectNodes(w, h, g.cornerRadius ?? 0), closed: true } : null;
  }
  const rx = Math.max(0, g.radiusX ?? 0);
  const ry = Math.max(0, g.radiusY ?? 0);
  return rx > 0 && ry > 0 ? { nodes: ellipseNodes(rx, ry), closed: true } : null;
}

/** The drawing's outline at `time` as PathData in the LAYER's local space: its own geometry
 *  mapped through its own transform (an affine map, so cubic handles map exactly). Null when
 *  the drawing is degenerate (zero size, < 2 nodes). */
export function layerLocalPath(obj: SceneObject, asset: VectorAsset, time: number): PathData | null {
  const path = ownPath(obj, asset, time);
  if (!path) return null;
  const state = sampleObject(obj, time, asset.primitive);
  const box = asset.shapeType === 'path' ? pathBounds(path) : undefined;
  const { anchorX, anchorY } = resolveAnchor(obj, state, asset.shapeType, box);
  const m = (p: PathPoint): PathPoint => mapPoint(state, anchorX, anchorY, p.x, p.y);
  const handle = (anchor: PathPoint, mapped: PathPoint, off?: PathPoint): PathPoint | undefined => {
    if (!off) return undefined;
    const h = m(add(anchor, off));
    return { x: h.x - mapped.x, y: h.y - mapped.y };
  };
  return {
    closed: path.closed,
    nodes: path.nodes.map((n) => {
      const a = m(n.anchor);
      const node: PathNode = { anchor: a };
      const i = handle(n.anchor, a, n.in);
      const o = handle(n.anchor, a, n.out);
      if (i) node.in = i;
      if (o) node.out = o;
      return node;
    }),
  };
}

/** Area-free centroid: the bounding-box centre (stable for open paths and slivers). */
function centre(path: PathData): PathPoint {
  const b = pathBounds(path);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** `path` collapsed onto point `c` — same node count, so it morphs index-to-index. */
function collapsed(path: PathData, c: PathPoint): PathData {
  return { closed: path.closed, nodes: path.nodes.map(() => ({ anchor: { ...c } })) };
}

interface Look {
  path: PathData;
  fill: string;
  stroke: string;
  opacity: number;
}

function lookOf(obj: SceneObject, asset: VectorAsset, time: number): Look | null {
  const path = layerLocalPath(obj, asset, time);
  if (!path) return null;
  const state = sampleObject(obj, time, asset.primitive);
  return {
    path,
    fill: state.fill ?? asset.style.fill,
    stroke: state.stroke ?? asset.style.stroke,
    opacity: state.opacity,
  };
}

const isSolid = (c: string) => c !== 'none' && parseHex(c) !== null;

function colorTrack(a: string, b: string, ta: number, tb: number, easing: Easing): ColorKeyframe[] | undefined {
  if (!isSolid(a) || !isSolid(b) || JSON.stringify(parseHex(a)) === JSON.stringify(parseHex(b))) return undefined;
  return [
    { time: ta, value: a, easing },
    { time: tb, value: b, easing: 'linear' },
  ];
}

function morphOf(a: PathData, b: PathData): Pick<ShapeKeyframe, 'morph'> {
  return a.nodes.length === b.nodes.length && a.closed === b.closed ? {} : { morph: 'resampled' };
}

/** Build the baked tweening object (the A drawing's id and links survive). */
function bakedObject(
  src: SceneObject,
  assetId: string,
  from: Look,
  to: Look,
  ta: number,
  tb: number,
  easing: Easing,
  pathFrom: PathData,
  pathTo: PathData,
): SceneObject {
  const out: SceneObject = {
    ...src,
    assetId,
    anchorMode: 'fraction',
    anchorX: 0.5,
    anchorY: 0.5,
    base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: from.opacity },
    tracks: {},
    shapeTrack: [
      { time: ta, path: pathFrom, easing, ...morphOf(pathFrom, pathTo) },
      { time: tb, path: pathTo, easing: 'linear' },
    ],
  };
  delete out.shapeBase;
  delete out.colorTracks;
  delete out.gradientTracks;
  delete out.motionPath;
  delete out.boolean;
  if (from.opacity !== to.opacity) {
    out.tracks.opacity = [
      { time: ta, value: from.opacity, easing },
      { time: tb, value: to.opacity, easing: 'linear' },
    ];
  }
  const fill = colorTrack(from.fill, to.fill, ta, tb, easing);
  const stroke = colorTrack(from.stroke, to.stroke, ta, tb, easing);
  if (fill || stroke) out.colorTracks = { ...(fill ? { fill } : {}), ...(stroke ? { stroke } : {}) };
  return out;
}

function pathAsset(src: VectorAsset, path: PathData, look: Look, id: string): VectorAsset {
  const style = { ...src.style, fill: look.fill, stroke: look.stroke };
  return createVectorAsset('path', { id, style, path });
}

function keysOf(layer: SceneObject): FrameKey[] {
  const order = frameKeySpans(layer.frames!).map((s) => s.id);
  return order.map((id) => layer.frames!.keys.find((k) => k.id === id)!);
}

function withTween(layer: SceneObject, keyId: string, tween: ShapeTween | undefined): SceneObject {
  return {
    ...layer,
    frames: {
      ...layer.frames!,
      keys: layer.frames!.keys.map((k) => {
        if (k.id !== keyId) return k;
        const next = { ...k };
        if (tween) next.tween = tween;
        else delete next.tween;
        return next;
      }),
    },
  };
}

const byZ = (a: SceneObject, b: SceneObject) => a.zOrder - b.zOrder;

/** Freeze a baked (tweening) drawing at `time`: a static path holding that instant's shape,
 *  fill, stroke and opacity. Returns the object and its updated path asset; null when `o` is
 *  not a morphing path (nothing to freeze). */
export function freezeTweenedDrawing(
  o: SceneObject,
  asset: VectorAsset | undefined,
  time: number,
): { object: SceneObject; asset: VectorAsset } | null {
  if (!asset || asset.shapeType !== 'path' || !o.shapeTrack?.length) return null;
  const state = sampleObject(o, time);
  const out: SceneObject = {
    ...o,
    base: { ...o.base, opacity: state.opacity },
    tracks: { ...o.tracks },
  };
  delete out.shapeTrack;
  delete out.colorTracks;
  delete out.tracks.opacity;
  const style = {
    ...asset.style,
    ...(state.fill !== undefined ? { fill: state.fill } : {}),
    ...(state.stroke !== undefined ? { stroke: state.stroke } : {}),
  };
  return { object: out, asset: { ...asset, path: state.path ?? asset.path, style } };
}

/** Undo a shape tween on key `keyId`: delete the objects it created, and leave each tweened A
 *  drawing as a static path holding its tween-start shape. No-op (same arrays) when the key has
 *  no tween. */
export function removeShapeTween(
  objects: SceneObject[],
  assets: Asset[],
  layerId: string,
  keyId: string,
): { objects: SceneObject[]; assets: Asset[] } {
  const layer = objects.find((o) => o.id === layerId);
  const key = layer?.frames?.keys.find((k) => k.id === keyId);
  if (!layer || !key?.tween) return { objects, assets };
  const created = new Set(key.tween.created ?? []);
  const assetUpdates = new Map<string, VectorAsset>();
  const nextObjects: SceneObject[] = [];
  for (const o of objects) {
    if (o.id === layerId) {
      nextObjects.push(withTween(o, keyId, undefined));
    } else if (o.parentId !== layerId || o.frameKeyId !== keyId) {
      nextObjects.push(o);
    } else if (!created.has(o.id)) {
      const frozen = freezeTweenedDrawing(o, vectorAssetOf(assets, o), o.shapeTrack?.[0]?.time ?? key.time);
      if (frozen) assetUpdates.set(frozen.asset.id, frozen.asset);
      nextObjects.push(frozen?.object ?? o);
    }
  }
  return { objects: nextObjects, assets: assets.map((a) => assetUpdates.get(a.id) ?? a) };
}

/** Re-derive every shape tween on `layerId` after its key timing changed (F5/F7, a moved key,
 *  an inserted or cleared key). A tween whose key is now last is removed. Same arrays when the
 *  layer has no tweens. */
export function rebakeLayerTweens(
  objects: SceneObject[],
  assets: Asset[],
  layerId: string,
  mintId?: () => string,
): { objects: SceneObject[]; assets: Asset[] } {
  const layer = objects.find((o) => o.id === layerId);
  if (!layer?.frames) return { objects, assets };
  const keys = keysOf(layer);
  // Last to first: re-baking key i reads key i+1's drawing at its start, which must already be
  // re-baked (its own tween frozen at the right shape) when i+1 is itself tweened.
  for (let i = keys.length - 1; i >= 0; i--) {
    const tween = keys[i].tween;
    if (!tween) continue;
    const res = i < keys.length - 1 ? bakeShapeTween(objects, assets, layerId, keys[i].id, { easing: tween.easing, newId: mintId }) : null;
    if (res && !('error' in res)) ({ objects, assets } = res);
    else ({ objects, assets } = removeShapeTween(objects, assets, layerId, keys[i].id));
  }
  return { objects, assets };
}

/** Bake (or re-bake) a shape tween from key `keyId` of frame layer `layerId` to the next key.
 *  Drawings pair by zOrder index; an unpartnered A drawing shrinks into its centre, an
 *  unpartnered B drawing gets a new object in key A that grows out of its centre. */
export function bakeShapeTween(
  objects: SceneObject[],
  assets: Asset[],
  layerId: string,
  keyId: string,
  /** `newId` mints ids for new assets and created objects (default random; agents pass a
   *  deterministic factory so a short stays reproducible). */
  opts: { easing?: Easing; newId?: () => string } = {},
): TweenBakeResult | { error: string } {
  const layer0 = objects.find((o) => o.id === layerId);
  if (!layer0?.frames) return { error: 'Not a frame layer.' };
  const keys0 = keysOf(layer0);
  const ai = keys0.findIndex((k) => k.id === keyId);
  if (ai < 0) return { error: 'No such key.' };
  if (ai === keys0.length - 1) return { error: 'A shape tween needs a following keyframe.' };

  // Re-bake = remove the old tween first, then bake from A's (now static) drawings.
  const cleared = removeShapeTween(objects, assets, layerId, keyId);
  objects = cleared.objects;
  assets = cleared.assets;
  const A = keys0[ai];
  const B = keys0[ai + 1];
  const easing: Easing = opts.easing ?? 'linear';
  const mint = opts.newId ?? newId;

  const drawings = (k: FrameKey) =>
    objects
      .filter((o) => o.parentId === layerId && o.frameKeyId === k.id)
      .filter((o) => tweenableDrawing(o, assets.find((a) => a.id === o.assetId)))
      .sort(byZ);
  const aDraw = drawings(A).map((o) => ({ o, asset: vectorAssetOf(assets, o)!, look: lookOf(o, vectorAssetOf(assets, o)!, A.time) }))
    .filter((d) => d.look);
  const bDraw = drawings(B).map((o) => ({ o, asset: vectorAssetOf(assets, o)!, look: lookOf(o, vectorAssetOf(assets, o)!, B.time) }))
    .filter((d) => d.look);
  if (aDraw.length === 0 && bDraw.length === 0) {
    return { error: 'Nothing to tween: shape tweens morph rectangles, ellipses and paths.' };
  }

  const replaced = new Map<string, SceneObject>();
  const newAssets: VectorAsset[] = [];
  const added: SceneObject[] = [];
  const n = Math.max(aDraw.length, bDraw.length);
  const topZ = Math.max(0, ...objects.filter((o) => o.parentId === layerId).map((o) => o.zOrder));
  for (let i = 0; i < n; i++) {
    const a = aDraw[i];
    const b = bDraw[i];
    if (a && b) {
      const asset = pathAsset(a.asset, a.look!.path, a.look!, mint());
      newAssets.push(asset);
      replaced.set(a.o.id, bakedObject(a.o, asset.id, a.look!, b.look!, A.time, B.time, easing, a.look!.path, b.look!.path));
    } else if (a) {
      const asset = pathAsset(a.asset, a.look!.path, a.look!, mint());
      newAssets.push(asset);
      const to = collapsed(a.look!.path, centre(a.look!.path));
      replaced.set(a.o.id, bakedObject(a.o, asset.id, a.look!, a.look!, A.time, B.time, easing, a.look!.path, to));
    } else if (b) {
      const from = collapsed(b.look!.path, centre(b.look!.path));
      const asset = pathAsset(b.asset, from, b.look!, mint());
      newAssets.push(asset);
      const src: SceneObject = { ...b.o, id: mint(), frameKeyId: A.id, zOrder: topZ + 1 + i };
      delete src.maskedBy;
      delete src.behaviors;
      added.push(bakedObject(src, asset.id, b.look!, b.look!, A.time, B.time, easing, from, b.look!.path));
    }
  }

  const tween: ShapeTween = { kind: 'shape' };
  if (easing !== 'linear') tween.easing = easing;
  if (added.length > 0) tween.created = added.map((o) => o.id);
  const nextObjects = [
    ...objects.map((o) => (o.id === layerId ? withTween(o, keyId, tween) : (replaced.get(o.id) ?? o))),
    ...added,
  ];
  return { objects: nextObjects, assets: [...assets, ...newAssets], tween };
}

/** True when key `keyId` of `layer` carries a shape tween. */
export function hasShapeTween(layer: SceneObject | undefined, keyId: string): boolean {
  return !!layer?.frames?.keys.find((k) => k.id === keyId)?.tween;
}
