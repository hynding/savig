// The single scene-walker for symbol-instance composition (slice 47a). Walks every scene
// (the top-level objects + each symbol's own objects[]), skips group containers (folding their
// transform into descendants via groupTransformPrefix) and render-hidden objects, expands
// symbol instances (composing transform + opacity, namespacing ids), and emits drawable leaves.
// Shared by computeFrame, renderDocument, and the editor Stage so preview == export.
import { buildTransform } from './transform';
import { sampleObject } from './sample';
import { groupTransformPrefix, isRenderHidden } from './groupTransform';
import type { Project, SceneObject } from './types';

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
        walk(asset.objects, localTime, instTransform, renderId, opacity * st.opacity, nextVisited);
      } else {
        leaves.push({ renderId, object: o, transformPrefix: fullPrefix, opacityFactor: opacity, localTime });
      }
    }
  };

  walk(project.objects, time, '', '', 1, new Set());
  return leaves;
}
