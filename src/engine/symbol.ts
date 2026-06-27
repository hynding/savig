// The single scene-walker for symbol-instance composition (slice 47a). Walks every scene
// (the top-level objects + each symbol's own objects[]), skips group containers (folding their
// transform into descendants via groupTransformPrefix) and render-hidden objects, expands
// symbol instances (composing transform + opacity, namespacing ids), and emits drawable leaves.
// Shared by computeFrame, renderDocument, and the editor Stage so preview == export.
import { buildTransform } from './transform';
import { sampleObject } from './sample';
import { groupTransformPrefix, isRenderHidden } from './groupTransform';
import { symbolEffectiveDuration } from './duration';
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
  scene: Pick<Project, 'objects' | 'assets'>,
): number {
  let n = 0;
  const countIn = (objects: SceneObject[]): void => {
    for (const o of objects) if (o.assetId === symId) n++;
  };
  countIn(scene.objects);
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
}

export function flattenInstances(project: Project, time: number): InstanceLeaf[] {
  const assetsById = new Map(project.assets.map((a) => [a.id, a] as const));
  const leaves: InstanceLeaf[] = [];

  const walk = (
    objects: SceneObject[],
    localTime: number,
    basePrefix: string,
    idPrefix: string,
    opacity: number,
    visited: Set<string>,
  ): void => {
    const objectsById = new Map(objects.map((o) => [o.id, o] as const));
    const ordered = objects
      .map((o, i) => ({ o, i }))
      .sort((a, b) => a.o.zOrder - b.o.zOrder || a.i - b.i);
    for (const { o } of ordered) {
      if (o.isGroup) continue; // its transform reaches children via groupTransformPrefix
      if (isRenderHidden(o, objectsById)) continue; // self-hidden or under a hidden group
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
        const childTime = o.symbolTime
          ? remapLocalTime(localTime, o.symbolTime, symbolEffectiveDuration(asset))
          : localTime;
        walk(asset.objects, childTime, instTransform, renderId, opacity * st.opacity, nextVisited);
      } else {
        leaves.push({ renderId, object: o, transformPrefix: fullPrefix, opacityFactor: opacity, localTime });
      }
    }
  };

  walk(project.objects, time, '', '', 1, new Set());
  return leaves;
}
