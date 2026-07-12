/** Headless, id-addressed, store-free authoring builders over a `Project`.
 *
 * Every function takes a `Project` (+ explicit args) and returns a NEW `Project` (or `{ project, id }`
 * when it creates an object) — no `useEditor`, no selection, no DOM. This is the agent/SDK surface;
 * the Zustand store keeps wrapping the same engine functions for humans. v1 is ROOT-SCENE only
 * (no symbol edit-path — a UI concern) and FAILS LOUD on bad references (a programmatic caller wants
 * an error, not the store's silent no-op). Object/asset ids are deterministic when an `id` is given
 * (the asset id is derived as `<id>-asset`), so a short is reproducible. */
import {
  createSceneObject,
  createVectorAsset,
  createTextAsset,
  createKeyframe,
  newId,
  upsertKeyframe,
  pathBounds,
  collectReferencedAssetIds,
  computeOutlineStrokeEffect,
  computeBlendSteps,
  materializeBlendStep,
  DEFAULT_TRANSFORM,
  DEFAULT_VECTOR_STYLE,
  ALL_ANIMATABLE_PROPERTIES,
} from '@savig/engine';
import { normalizeTrim, normalizeRepeat, TRIM_TRACK_KEYS, REPEAT_DEFAULTS } from '@savig/engine';
import type {
  AnimatableProperty,
  Easing,
  EasingName,
  PathData,
  Project,
  RepeatSpec,
  SceneObject,
  Transform2D,
  TrimPath,
  TrimProperty,
  TrimValues,
  VectorAsset,
  VectorStyle,
} from '@savig/engine';

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

function nextZ(objects: SceneObject[]): number {
  return objects.reduce((m, o) => Math.max(m, o.zOrder), -1) + 1;
}

function requireObject(project: Project, id: string): SceneObject {
  const o = project.objects.find((x) => x.id === id);
  if (!o) throw new Error(`savig/core: no object with id "${id}"`);
  return o;
}

function replaceObject(project: Project, next: SceneObject): Project {
  return { ...project, objects: project.objects.map((o) => (o.id === next.id ? next : o)) };
}

interface ShapeOpts {
  x: number;
  y: number;
  width: number;
  height: number;
  id?: string;
  name?: string;
  style?: Partial<VectorStyle>;
}

/** Add an axis-aligned rectangle. Vector objects use fractional-centre anchors, so no bbox math is
 *  needed at build time (the renderer resolves the pivot from `shapeBase` per frame). */
export function addRect(project: Project, opts: ShapeOpts): { project: Project; id: string } {
  return addShape(project, 'rect', opts, { width: opts.width, height: opts.height });
}

/** Add an ellipse. `width`/`height` are the bounding box; stored as radiusX/radiusY. */
export function addEllipse(project: Project, opts: ShapeOpts): { project: Project; id: string } {
  return addShape(project, 'ellipse', opts, { radiusX: opts.width / 2, radiusY: opts.height / 2 });
}

function addShape(
  project: Project,
  shapeType: 'rect' | 'ellipse',
  opts: ShapeOpts,
  shapeBase: SceneObject['shapeBase'],
): { project: Project; id: string } {
  const id = opts.id ?? newId();
  const asset = createVectorAsset(shapeType, {
    id: `${id}-asset`,
    style: { ...DEFAULT_VECTOR_STYLE, ...opts.style },
  });
  const z = nextZ(project.objects);
  const obj = createSceneObject(asset.id, {
    id,
    name: opts.name ?? `${shapeType === 'rect' ? 'Rectangle' : 'Ellipse'} ${z + 1}`,
    zOrder: z,
    anchorMode: 'fraction',
    anchorX: 0.5,
    anchorY: 0.5,
    base: { ...DEFAULT_TRANSFORM, x: opts.x, y: opts.y },
    shapeBase,
  });
  return {
    project: { ...project, assets: [...project.assets, asset], objects: [...project.objects, obj] },
    id,
  };
}

/** Add a free vector path. The path is normalized so its bbox top-left sits at local origin and the
 *  object's base transform places it (mirrors the pen/import path — keeps anchors/transforms sane). */
export function addPath(
  project: Project,
  opts: { path: PathData; id?: string; name?: string; style?: Partial<VectorStyle> },
): { project: Project; id: string } {
  if (opts.path.nodes.length < 2) throw new Error('savig/core: addPath needs at least 2 nodes');
  const id = opts.id ?? newId();
  const box = pathBounds(opts.path);
  const normalized: PathData = {
    closed: opts.path.closed,
    nodes: opts.path.nodes.map((n) => ({
      anchor: { x: n.anchor.x - box.x, y: n.anchor.y - box.y },
      ...(n.in ? { in: n.in } : {}),
      ...(n.out ? { out: n.out } : {}),
    })),
  };
  const asset = createVectorAsset('path', {
    id: `${id}-asset`,
    path: normalized,
    style: { ...DEFAULT_VECTOR_STYLE, ...opts.style },
  });
  const z = nextZ(project.objects);
  const obj = createSceneObject(asset.id, {
    id,
    name: opts.name ?? `Path ${z + 1}`,
    zOrder: z,
    anchorMode: 'fraction',
    anchorX: 0.5,
    anchorY: 0.5,
    base: { ...DEFAULT_TRANSFORM, x: box.x, y: box.y },
  });
  return {
    project: { ...project, assets: [...project.assets, asset], objects: [...project.objects, obj] },
    id,
  };
}

/** Add a text object (title/caption/kinetic type) at (x, y) — the top-left of the text. Animates
 *  via the generic transform/opacity tracks. */
export function addText(
  project: Project,
  opts: { content: string; x: number; y: number; fontSize?: number; fontFamily?: string; fill?: string; stroke?: string; strokeWidth?: number; textAnchor?: 'start' | 'middle' | 'end'; id?: string; name?: string },
): { project: Project; id: string } {
  const id = opts.id ?? newId();
  const asset = createTextAsset({
    id: `${id}-asset`,
    content: opts.content,
    ...(opts.fontSize !== undefined ? { fontSize: opts.fontSize } : {}),
    ...(opts.fontFamily !== undefined ? { fontFamily: opts.fontFamily } : {}),
    ...(opts.fill !== undefined ? { fill: opts.fill } : {}),
    ...(opts.stroke !== undefined ? { stroke: opts.stroke } : {}),
    ...(opts.strokeWidth !== undefined ? { strokeWidth: opts.strokeWidth } : {}),
    ...(opts.textAnchor !== undefined ? { textAnchor: opts.textAnchor } : {}),
  });
  const z = nextZ(project.objects);
  const obj = createSceneObject(asset.id, {
    id,
    name: opts.name ?? `Text ${z + 1}`,
    zOrder: z,
    anchorMode: 'absolute',
    anchorX: 0,
    anchorY: 0,
    base: { ...DEFAULT_TRANSFORM, x: opts.x, y: opts.y },
  });
  return {
    project: { ...project, assets: [...project.assets, asset], objects: [...project.objects, obj] },
    id,
  };
}

/** Upsert a keyframe on a transform/geometry track (x/y/scaleX/scaleY/rotation/opacity/width/…). */
export function setKeyframe(
  project: Project,
  spec: { objectId: string; property: AnimatableProperty; time: number; value: number; easing?: Easing },
): Project {
  if (!ALL_ANIMATABLE_PROPERTIES.includes(spec.property)) {
    throw new Error(
      `savig/core: unknown animatable property "${spec.property}" (valid: ${ALL_ANIMATABLE_PROPERTIES.join(', ')})`,
    );
  }
  const obj = requireObject(project, spec.objectId);
  const track = upsertKeyframe(
    obj.tracks[spec.property] ?? [],
    createKeyframe(spec.time, spec.value, spec.easing ? { easing: spec.easing } : {}),
  );
  return replaceObject(project, { ...obj, tracks: { ...obj.tracks, [spec.property]: track } });
}

/** Set trim base values (0..1, clamped). Identity with no tracks clears `trim`. */
export function setTrim(project: Project, objectId: string, values: Partial<TrimValues>): Project {
  const obj = requireObject(project, objectId);
  const cur: TrimPath = obj.trim ?? { start: 0, end: 1, offset: 0 };
  const next: TrimPath = { ...cur };
  for (const prop of ['start', 'end', 'offset'] as const) {
    if (values[prop] !== undefined) next[prop] = clamp01(values[prop]!);
  }
  return replaceObject(project, { ...obj, trim: normalizeTrim(next) });
}

/** Upsert a trim keyframe (creates `trim` at identity if absent). */
export function setTrimKeyframe(
  project: Project,
  o: { objectId: string; prop: TrimProperty; time: number; value: number; easing?: Easing },
): Project {
  const obj = requireObject(project, o.objectId);
  const cur: TrimPath = obj.trim ?? { start: 0, end: 1, offset: 0 };
  const trackKey = TRIM_TRACK_KEYS[o.prop];
  const track = upsertKeyframe(
    cur[trackKey] ?? [],
    createKeyframe(o.time, clamp01(o.value), o.easing ? { easing: o.easing } : {}),
  );
  return replaceObject(project, { ...obj, trim: { ...cur, [trackKey]: track } });
}

/** Merge a partial RepeatSpec onto the object (default-enable {count:2,dx:0,dy:0,rotate:0,scale:1,
 *  stagger:0} when absent), normalized on write via `normalizeRepeat` (count <= 1 or any non-finite
 *  field clears `repeat`, byte-clean). Throws on a group or symbol-instance target — repeat is only
 *  meaningful on a plain leaf (mirrors editor-state's `canRepeat` gate). */
export function setRepeat(project: Project, objectId: string, spec: Partial<RepeatSpec>): Project {
  const obj = requireObject(project, objectId);
  if (obj.isGroup) throw new Error(`savig/core: setRepeat cannot target a group ("${objectId}")`);
  const asset = project.assets.find((a) => a.id === obj.assetId);
  if (asset?.kind === 'symbol') {
    throw new Error(`savig/core: setRepeat cannot target a symbol instance ("${objectId}")`);
  }
  const base: RepeatSpec = obj.repeat ?? REPEAT_DEFAULTS;
  return replaceObject(project, { ...obj, repeat: normalizeRepeat({ ...base, ...spec }) });
}

/** Write any of the static base transform fields (used when a property has no keyframes). */
export function setBaseTransform(project: Project, objectId: string, partial: Partial<Transform2D>): Project {
  const obj = requireObject(project, objectId);
  return replaceObject(project, { ...obj, base: { ...obj.base, ...partial } });
}

/** Outline a path's stroke into fill geometry (the agent/SDK surface for the editor's outline-stroke
 *  op). SAME model-level gates as the store's `outlineStroke` — non-path shapeType, invisible stroke,
 *  a morphing `shapeTrack`, existing `compoundRings`, a live-boolean result, or a live-boolean
 *  operand — mirrored here as THROWS (a programmatic caller wants an error, not a silent toast+no-op).
 *  Locks are editor-only (no selection/UI concept at this layer) and are skipped. The actual
 *  asset/object rebuild — path/compoundRings, fresh-literal style swap, dropped animation channels,
 *  anchor pinning, primitive-detach — is the SAME pure computation the store op uses
 *  (`computeOutlineStrokeEffect` in `@savig/engine`), so the two surfaces can't drift on what an
 *  outline produces for the same input. A degenerate offset (e.g. a zero-length path) returns the
 *  project unchanged — mirrors the store's silent no-op. */
export function outlineStrokePath(project: Project, objectId: string): Project {
  const obj = requireObject(project, objectId);
  const asset = project.assets.find((a) => a.id === obj.assetId);
  if (!asset || asset.kind !== 'vector' || asset.shapeType !== 'path') {
    throw new Error(`savig/core: outlineStrokePath target is not a path ("${objectId}")`);
  }
  if (asset.style.stroke === 'none' || asset.style.strokeWidth <= 0) {
    throw new Error(`savig/core: outlineStrokePath target has no visible stroke ("${objectId}")`);
  }
  if (obj.shapeTrack && obj.shapeTrack.length > 0) {
    throw new Error(`savig/core: outlineStrokePath cannot outline a morphing path ("${objectId}")`);
  }
  if (asset.compoundRings && asset.compoundRings.length > 0) {
    throw new Error(`savig/core: outlineStrokePath cannot outline compound shapes ("${objectId}")`);
  }
  if (obj.boolean) {
    throw new Error(`savig/core: outlineStrokePath cannot outline a boolean result ("${objectId}")`);
  }
  // Scene-correct as long as the caller routes through `withScene` (MCP/DSL always do, see
  // scenes.ts): withScene projects the CURRENT scene's objects onto `project.objects` before
  // calling in and merges them back after, so this scan sees that scene's operand links. A direct
  // multi-scene-root caller invoking this without `withScene` would only see root `project.objects`
  // and miss operand links that live inside `project.scenes[].objects`.
  if (project.objects.some((o) => o.boolean?.operandIds.includes(objectId))) {
    throw new Error(`savig/core: outlineStrokePath cannot outline a live-boolean operand ("${objectId}")`);
  }

  const effect = computeOutlineStrokeEffect(obj, asset);
  if (!effect) return project; // degenerate offset (e.g. a zero-length path) — silent no-op
  const { nextAsset, nextObj } = effect;
  const withAsset = { ...project, assets: project.assets.map((a) => (a.id === asset.id ? nextAsset : a)) };
  return replaceObject(withAsset, nextObj);
}

/** Blend eligibility, as a DISTINCT throw per gate rather than one collapsed boolean — a
 *  programmatic caller gets a specific reason, not outlineStrokePath's-style catch-all. Mirrors
 *  editor-state's `isBlendEligible` ASSET-side rules exactly (group container / live-boolean
 *  result / live-boolean operand / `repeat` / morphing `shapeTrack` / not-a-vector-path /
 *  empty path / `compoundRings`). LOCK is intentionally NOT checked — locks are an editor/UI
 *  concept with no meaning at this headless layer (outlineStrokePath's precedent: "Locks are
 *  editor-only ... and are skipped"). `label` ('A' or 'B') names which of the two blend targets
 *  failed, since blendPaths validates both independently. */
function requireBlendTarget(project: Project, id: string, label: 'A' | 'B'): SceneObject {
  const obj = project.objects.find((o) => o.id === id);
  if (!obj) throw new Error(`savig/core: blendPaths target ${label} not found ("${id}")`);
  if (obj.isGroup) {
    throw new Error(`savig/core: blendPaths target ${label} is a group, not a path ("${id}")`);
  }
  if (obj.boolean) {
    throw new Error(`savig/core: blendPaths target ${label} is a live-boolean result ("${id}")`);
  }
  if (project.objects.some((o) => o.boolean?.operandIds.includes(id))) {
    throw new Error(`savig/core: blendPaths target ${label} is a live-boolean operand ("${id}")`);
  }
  if (obj.repeat) {
    throw new Error(`savig/core: blendPaths target ${label} has a repeater, not a plain path ("${id}")`);
  }
  if (obj.shapeTrack && obj.shapeTrack.length > 0) {
    throw new Error(`savig/core: blendPaths target ${label} is already morphing ("${id}")`);
  }
  const asset = project.assets.find((a) => a.id === obj.assetId);
  if (!asset || asset.kind !== 'vector' || asset.shapeType !== 'path') {
    throw new Error(`savig/core: blendPaths target ${label} is not a vector path ("${id}")`);
  }
  if (!asset.path || asset.path.nodes.length === 0) {
    throw new Error(`savig/core: blendPaths target ${label} has an empty path ("${id}")`);
  }
  if (asset.compoundRings && asset.compoundRings.length > 0) {
    throw new Error(`savig/core: blendPaths target ${label} has compound shapes — release them first ("${id}")`);
  }
  return obj;
}

/** Blend two vector paths into `count` new intermediate objects (the agent/SDK surface for the
 *  editor's Blend op). A/B are resolved from the GIVEN `aId`/`bId` — a DELIBERATE DSL difference
 *  from the store's `blendSelected`, which infers A/B from zOrder (stacking) because a click
 *  selection carries no order intent of its own; here the caller's explicit ids ARE the intent,
 *  so `aId` is always the blend-from end and `bId` the blend-to end, regardless of either
 *  object's position in `project.objects`. SAME model-level gates as the store (via
 *  `requireBlendTarget`, above), the SAME geometry/style math (`computeBlendSteps` in
 *  `@savig/engine`), and the SAME per-step normalization (bbox-shift the anchor, keep bezier
 *  handles, `anchorMode: 'fraction'` at 0.5/0.5, `Blend i` names, sequential zOrder) — the
 *  latter now STRUCTURALLY shared with `blendSelected` via `@savig/engine`'s
 *  `materializeBlendStep` (task 1 hardening; previously byte-identical only by convention), so
 *  the two surfaces can never produce different objects for the same input. Time is NOT
 *  threaded through (defaults to `computeBlendSteps`'s `time ?? 0`) — this is a headless,
 *  playhead-free layer, `outlineStrokePath`'s precedent. Fails LOUD: dangling `aId`/`bId`, an
 *  ineligible target (with the specific reason), or `count < 1`. */
export function blendPaths(
  project: Project,
  aId: string,
  bId: string,
  count: number,
  opts?: { easing?: EasingName },
): { project: Project; ids: string[] } {
  if (!Number.isFinite(count) || count < 1) {
    throw new Error(`savig/core: blendPaths count must be >= 1 (got ${count})`);
  }
  const objA = requireBlendTarget(project, aId, 'A');
  const objB = requireBlendTarget(project, bId, 'B');

  const steps = computeBlendSteps(project, objA, objB, { count, easing: opts?.easing as Easing | undefined });
  if (!steps) {
    // Defensive fallback only — requireBlendTarget above already enforces every asset-side gate
    // computeBlendSteps checks, so this should never actually fire.
    throw new Error(`savig/core: blendPaths could not blend "${aId}" and "${bId}"`);
  }

  const z = nextZ(project.objects);
  const newObjects: SceneObject[] = [];
  const newAssets: VectorAsset[] = [];
  steps.forEach((step, i) => {
    const { asset, obj: newObj } = materializeBlendStep(step, i, z);
    newAssets.push(asset);
    newObjects.push(newObj);
  });

  return {
    project: {
      ...project,
      assets: [...project.assets, ...newAssets],
      objects: [...project.objects, ...newObjects],
    },
    ids: newObjects.map((o) => o.id),
  };
}

/** Remove objects (cascading group descendants) and prune the now-orphaned vector/svg assets they
 *  referenced — never prunes symbol (library) / audio assets, nor assets still referenced elsewhere.
 *  Mirrors the store delete's cross-scene-safe prune. */
export function removeObjects(project: Project, ids: string[]): Project {
  const toDelete = new Set(ids);
  for (let changed = true; changed; ) {
    changed = false;
    for (const o of project.objects) {
      if (o.parentId && toDelete.has(o.parentId) && !toDelete.has(o.id)) {
        toDelete.add(o.id);
        changed = true;
      }
    }
  }
  const candidateAssetIds = new Set(
    project.objects.filter((o) => toDelete.has(o.id) && o.assetId).map((o) => o.assetId),
  );
  let next: Project = { ...project, objects: project.objects.filter((o) => !toDelete.has(o.id)) };
  const referenced = collectReferencedAssetIds(next);
  next = {
    ...next,
    assets: next.assets.filter((a) => {
      if (!candidateAssetIds.has(a.id)) return true;
      if (a.kind === 'symbol' || a.kind === 'audio') return true;
      return referenced.has(a.id);
    }),
  };
  return next;
}
