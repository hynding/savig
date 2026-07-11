// The single scene-walker for symbol-instance composition (slice 47a). Walks every scene
// (the top-level objects + each symbol's own objects[]), skips group containers (folding their
// transform into descendants via groupTransformPrefix) and render-hidden objects, expands
// symbol instances (composing transform + opacity, namespacing ids), and emits drawable leaves.
// Shared by computeFrame, renderDocument, and the editor Stage so preview == export.
import { buildTransform } from './transform';
import { sampleObject } from './sample';
import { interpolate } from './interpolate';
import { groupTransformPrefix, isRenderHidden, groupDescendantIds } from './groupTransform';
import { symbolEffectiveDuration } from './duration';
import { normalizeRepeat, repeatDeltaTransform } from './repeat';
import type { Asset, Project, SceneObject, SymbolTiming } from './types';

/** Does `containerSymId` transitively contain an instance of `targetSymId`? Walks the container
 *  symbol's scene, recursing into nested symbol instances; cycle-guarded by a visited-asset Set so
 *  a corrupt self-referential file terminates. The authoring-time cycle guard (slice 47d). */
export function symbolContains(containerSymId: string, targetSymId: string, assets: Asset[]): boolean {
  const byId = new Map(assets.map((a) => [a.id, a] as const));
  const seen = new Set<string>();
  const walk = (symId: string): boolean => {
    if (seen.has(symId)) return false; // already visited on this search
    seen.add(symId);
    const sym = byId.get(symId);
    if (!sym || sym.kind !== 'symbol') return false;
    for (const o of sym.objects) {
      const child = byId.get(o.assetId);
      if (child && child.kind === 'symbol') {
        if (o.assetId === targetSymId) return true;
        if (walk(o.assetId)) return true;
      }
    }
    return false;
  };
  return walk(containerSymId);
}

/** Total objects referencing `symId` across the root scene AND every symbol asset's objects[] (47d).
 *  Takes only the scene pieces it reads (not a whole Project) so UI callers can subscribe narrowly. */
export function countSymbolInstances(
  symId: string,
  scene: Pick<Project, 'objects' | 'assets' | 'scenes'>,
): number {
  let n = 0;
  const countIn = (objects: SceneObject[]): void => {
    for (const o of objects) if (o.assetId === symId) n++;
  };
  if (scene.scenes) for (const s of scene.scenes) countIn(s.objects);
  else countIn(scene.objects);
  for (const a of scene.assets) if (a.kind === 'symbol') countIn(a.objects);
  return n;
}

/** Map the PARENT scene's local time to this instance's internal local time (slice 47c): shift to
 *  the start, scale by speed, hold the first frame before the start, then LOOP (wrap into
 *  [0,duration)) or ONE-SHOT (hold the last frame). `symbolDuration` is the symbol's intrinsic
 *  content length; a zero-duration symbol is static, so any remap collapses to 0.
 *  (`symbolEffectiveDuration`, which resolves that content length, now lives in ./duration.) */
export function remapLocalTime(parentTime: number, timing: SymbolTiming, symbolDuration: number): number {
  const t = (parentTime - timing.startOffset) * timing.speed + (timing.phase ?? 0); // phase = a head-start on the internal clock (47c)
  if (t <= 0) return 0; // before start (or at it): first frame
  if (symbolDuration <= 0) return 0; // static symbol
  if (!timing.loop) return Math.min(t, symbolDuration); // one-shot: play once, hold last frame
  if (timing.playCount && timing.playCount > 0) {
    const cycle = timing.pingPong ? 2 * symbolDuration : symbolDuration;
    if (t >= timing.playCount * cycle) return timing.pingPong ? 0 : symbolDuration; // exhausted: hold final frame
  }
  if (timing.pingPong) {
    const m = t % (2 * symbolDuration); // t > 0 so m is in [0, 2*dur)
    return m <= symbolDuration ? m : 2 * symbolDuration - m; // forward, then mirrored back
  }
  return t % symbolDuration; // t > 0, so the mod is in range
}

export interface InstanceLeaf {
  /** Composite render id: the instance-path joined, e.g. "instA/instB/shapeS". Used as
   *  data-savig-object, the runtime nodes-map key, and the React skeleton key. For a
   *  non-instanced object this is exactly the object id (parity). */
  renderId: string;
  /** The leaf SceneObject to draw. Its asset resolves against the GLOBAL assets[]; its
   *  geometry/color/etc. are sampled with the existing per-object `sampleObject`. */
  object: SceneObject;
  /** Fully-composed transform PREFIX to prepend to the leaf's own buildTransform(...): all
   *  ancestor instance transforms AND each scene's in-scene group prefix, interleaved
   *  outermost-first. Empty for a top-level, ungrouped object. */
  transformPrefix: string;
  /** Product of ancestor-instance opacities (0..1), multiplied into the leaf's own opacity. */
  opacityFactor: number;
  /** The LOCAL time at which to sample this leaf. In 47a this is always the global time
   *  (no remap); 47c makes it remap(globalTime, instanceChain). */
  localTime: number;
  /** Present iff this leaf belongs to a clipping symbol instance (slice 47e). All leaves
   *  sharing this id must be wrapped under a `<g clip-path="url(#clipId)">` in both the
   *  export and the editor Stage. The id is unique per instance path
   *  (`"clip-" + instId` for top-level; `"clip-" + outerInstId + "/" + innerInstId` for
   *  nested — v1 only clips the outermost clipping ancestor). */
  clipId?: string;
  /** The instance's composed world-transform string. The clip rect carries this same
   *  transform so it occupies the same coordinate space as the symbol's content.
   *  Present iff `clipId` is present. */
  clipTransform?: string;
  /** The clipping symbol's intrinsic width (clip rect width). Present iff `clipId` is present. */
  clipWidth?: number;
  /** The clipping symbol's intrinsic height (clip rect height). Present iff `clipId` is present. */
  clipHeight?: number;
  /** Present iff this leaf belongs to a tinted symbol instance (slice 47f). All leaves
   *  sharing this id must be wrapped under a `<g filter="url(#tintId)">` group with a
   *  feFlood+feComposite+feBlend multiply filter. The id is unique per instance path. */
  tintId?: string;
  /** The tint overlay color (CSS hex). Present iff `tintId` is present. */
  tintColor?: string;
  /** The tint overlay strength (0..1). Present iff `tintId` is present. */
  tintAmount?: number;
}

export function flattenInstances(project: Project, time: number): InstanceLeaf[] {
  const assetsById = new Map(project.assets.map((a) => [a.id, a] as const));
  const leaves: InstanceLeaf[] = [];
  // Objects consumed by a live boolean (its operands) are sampled for the clip but not drawn
  // directly. A GROUP operand contributes the union of its leaf descendants, so the WHOLE subtree
  // must be hidden (the group id itself never draws as a leaf anyway). A nested-boolean operand
  // needs no special case: its id is an operandId here, and its own operandIds are collected by the
  // same loop across all boolean objects (with their group subtrees expanded in turn). Root-scene
  // only in slice 1/2/3.
  const consumed = new Set<string>();
  const rootById = new Map(project.objects.map((o) => [o.id, o] as const));
  for (const o of project.objects) {
    for (const id of o.boolean?.operandIds ?? []) {
      consumed.add(id);
      if (rootById.get(id)?.isGroup) {
        for (const d of groupDescendantIds(project.objects, id)) consumed.add(d);
      }
    }
  }

  const walk = (
    objects: SceneObject[],
    localTime: number,
    basePrefix: string,
    idPrefix: string,
    opacity: number,
    visited: Set<string>,
    /** Clip context from an enclosing clipping symbol (v1: outermost clipping ancestor only). */
    clipCtx?: { clipId: string; clipTransform: string; clipWidth: number; clipHeight: number },
    /** Tint context from an enclosing tinted symbol instance (slice 47f). */
    tintCtx?: { tintId: string; tintColor: string; tintAmount: number },
  ): void => {
    const objectsById = new Map(objects.map((o) => [o.id, o] as const));
    const ordered = objects
      .map((o, i) => ({ o, i }))
      .sort((a, b) => a.o.zOrder - b.o.zOrder || a.i - b.i);
    for (const { o } of ordered) {
      if (o.isGroup) continue; // its transform reaches children via groupTransformPrefix
      if (isRenderHidden(o, objectsById)) continue; // self-hidden or under a hidden group
      if (consumed.has(o.id)) continue; // a live boolean's operand: sampled for the clip, not drawn directly
      const groupPrefix = groupTransformPrefix(objects, o, localTime);
      const fullPrefix = [basePrefix, groupPrefix].filter(Boolean).join(' ');
      const renderId = idPrefix ? `${idPrefix}/${o.id}` : o.id;
      const asset = assetsById.get(o.assetId);
      if (asset && asset.kind === 'symbol') {
        if (visited.has(asset.id)) continue; // cycle guard: a symbol cannot contain itself
        const st = sampleObject(o, localTime);
        const instTransform = [fullPrefix, buildTransform(st, o.anchorX, o.anchorY)]
          .filter(Boolean)
          .join(' ');
        const nextVisited = new Set(visited);
        nextVisited.add(asset.id);
        // The INSTANCE's own transform sampled at the parent timeline (st, above); its INTERNALS
        // sample at the per-instance remapped time (47c). Absent symbolTime => identity (parity).
        // Freeze first frame (47f): wins over all other remap logic — forces childTime to 0.
        const childTime =
          o.freezeFirstFrame
            ? 0
            : o.symbolTimeTrack && o.symbolTimeTrack.length > 0
              ? Math.max(0, interpolate(o.symbolTimeTrack, localTime)) // direct keyframed remap (47c); supersedes symbolTime
              : o.symbolTime
                ? remapLocalTime(localTime, o.symbolTime, symbolEffectiveDuration(asset))
                : localTime;
        // Clip context (slice 47e): when this symbol has clip:true and there is no
        // enclosing clip already, establish a new clip context for its leaves.
        // v1: only the outermost clipping ancestor establishes the context; a nested
        // clipping symbol inherits the outer context (its own clip is not added — deferred).
        const nextClipCtx: { clipId: string; clipTransform: string; clipWidth: number; clipHeight: number } | undefined =
          asset.clip && !clipCtx
            ? { clipId: `clip-${renderId}`, clipTransform: instTransform, clipWidth: asset.width, clipHeight: asset.height }
            : clipCtx;
        // Tint context (slice 47f): when this instance has a tint, establish a new tint context.
        // Each instance level gets its own tintId; nested tints will each emit their own filter
        // (v1: innermost tint context wins for the leaf's tintId, as tintCtx accumulates).
        const nextTintCtx: { tintId: string; tintColor: string; tintAmount: number } | undefined =
          o.tint
            ? { tintId: `savig-tint-${renderId}`, tintColor: o.tint.color, tintAmount: o.tint.amount }
            : tintCtx;
        walk(asset.objects, childTime, instTransform, renderId, opacity * st.opacity, nextVisited, nextClipCtx, nextTintCtx);
      } else {
        // Repeater (art-tools #3): expand a plain leaf with a valid repeat spec into `count`
        // copies. k=0 always reproduces the pre-repeat push exactly (delta='', localTime
        // unchanged) — normalizeRepeat(undefined-ish/invalid specs) => undefined => copies=1 =>
        // byte-identical to the single push below (parity for every non-repeated leaf).
        const repeat = o.repeat ? normalizeRepeat(o.repeat) : undefined;
        const copies = repeat ? repeat.count : 1;
        for (let k = 0; k < copies; k++) {
          const delta = repeat ? repeatDeltaTransform(repeat, k) : '';
          leaves.push({
            renderId: k === 0 ? renderId : `${renderId}@${k}`,
            object: o,
            transformPrefix: delta ? (fullPrefix ? `${fullPrefix} ${delta}` : delta) : fullPrefix,
            opacityFactor: opacity,
            localTime: repeat && k > 0 ? Math.max(0, localTime - k * repeat.stagger) : localTime,
            ...(clipCtx ? {
              clipId: clipCtx.clipId,
              clipTransform: clipCtx.clipTransform,
              clipWidth: clipCtx.clipWidth,
              clipHeight: clipCtx.clipHeight,
            } : {}),
            ...(tintCtx ? {
              tintId: tintCtx.tintId,
              tintColor: tintCtx.tintColor,
              tintAmount: tintCtx.tintAmount,
            } : {}),
          });
        }
      }
    }
  };

  walk(project.objects, time, '', '', 1, new Set());
  return leaves;
}
