// Spray brush (roadmap 12): scatter copies of a symbol (or plain dots) along a stroke, as Flash's
// Spray Brush does. The particles come from the engine's deterministic `sprayParticles`, so the
// Stage preview matches the commit; one stroke = one undo step = one "Spray N" group.
import {
  DEFAULT_TRANSFORM, createGroupObject, createSceneObject, createVectorAsset, newId, normalizeSpraySettings,
  snapToFrame, sprayParticles, swatchColor, symbolContains,
} from '@savig/engine';
import type { Asset, SceneObject, SymbolAsset } from '@savig/engine';
import { sceneContentAABB } from '@savig/interaction';
import { selectActiveAssetId, selectActiveObjects, selectActiveScope } from '../selectors';
import { nextZOrder, writeSceneObjects } from '../store-internals';
import type { SliceCreator, SprayOptions } from '../store-internals';

type SprayKeys = 'setSprayOptions' | 'sprayStroke';

function clampOptions(cur: SprayOptions, patch: Partial<SprayOptions>): SprayOptions {
  const merged = { ...cur, ...patch };
  const n = normalizeSpraySettings({ ...merged, seed: 1 });
  const dot = Number.isFinite(merged.dotSize) ? Math.min(200, Math.max(1, merged.dotSize)) : cur.dotSize;
  return {
    symbolId: typeof merged.symbolId === 'string' && merged.symbolId ? merged.symbolId : null,
    radius: Math.min(500, n.radius),
    density: n.density,
    scaleMin: n.scaleMin,
    scaleMax: n.scaleMax,
    rotation: n.rotation,
    dotSize: dot,
    color: swatchColor(merged.color) ?? cur.color,
  };
}

/** "Spray", then "Spray 2", "Spray 3"… among the scene's objects. */
function sprayName(objects: SceneObject[]): string {
  const taken = new Set(objects.map((o) => o.name));
  if (!taken.has('Spray')) return 'Spray';
  let n = 2;
  while (taken.has(`Spray ${n}`)) n++;
  return `Spray ${n}`;
}

export const createSpraySlice: SliceCreator<SprayKeys> = (set, get) => ({
  setSprayOptions(patch) {
    set({ spray: clampOptions(get().spray, patch) });
  },

  sprayStroke(points, seed) {
    const s = get();
    const project = s.history.present;
    const opts = s.spray;
    const particles = sprayParticles(points, { ...opts, seed });
    if (particles.length === 0) return null;

    // A chosen symbol must exist and must not contain the symbol being edited.
    let symbol: SymbolAsset | null = null;
    if (opts.symbolId) {
      const a = project.assets.find((x) => x.id === opts.symbolId);
      if (a?.kind === 'symbol') {
        const containing = selectActiveAssetId(s);
        if (containing && (a.id === containing || symbolContains(a.id, containing, project.assets))) {
          get().pushToast('error', `Can't spray ${a.name} here — it would contain itself.`);
          return null;
        }
        symbol = a;
      }
    }

    const objects = selectActiveObjects(s);
    const z = nextZOrder(objects);
    const gid = newId();
    const cx = particles.reduce((m, p) => m + p.x, 0) / particles.length;
    const cy = particles.reduce((m, p) => m + p.y, 0) / particles.length;
    const group = createGroupObject({ id: gid, name: sprayName(objects), anchorX: cx, anchorY: cy, zOrder: z });
    const newAssets: Asset[] = [];
    const children: SceneObject[] = [];

    if (symbol) {
      const box = sceneContentAABB(symbol.objects, project.assets, snapToFrame(s.time, project.meta.fps));
      const ax = box ? (box.minX + box.maxX) / 2 : 0;
      const ay = box ? (box.minY + box.maxY) / 2 : 0;
      particles.forEach((p, i) => {
        children.push(createSceneObject(symbol!.id, {
          name: `${symbol!.name} ${i + 1}`,
          zOrder: z + 1 + i,
          parentId: gid,
          anchorX: ax,
          anchorY: ay,
          base: { ...DEFAULT_TRANSFORM, x: p.x - ax, y: p.y - ay, scaleX: p.scale, scaleY: p.scale, rotation: p.rotation },
        }));
      });
    } else {
      particles.forEach((p, i) => {
        const r = (opts.dotSize / 2) * p.scale;
        const asset = createVectorAsset('ellipse', { name: 'Dot', style: { fill: opts.color, stroke: 'none', strokeWidth: 0 } });
        newAssets.push(asset);
        children.push(createSceneObject(asset.id, {
          name: `Dot ${i + 1}`,
          zOrder: z + 1 + i,
          parentId: gid,
          anchorMode: 'fraction',
          anchorX: 0.5,
          anchorY: 0.5,
          base: { ...DEFAULT_TRANSFORM, x: p.x - r, y: p.y - r },
          shapeBase: { radiusX: r, radiusY: r },
        }));
      });
    }

    const withAssets = newAssets.length ? { ...project, assets: [...project.assets, ...newAssets] } : project;
    get().commit(writeSceneObjects(withAssets, selectActiveScope(s), (o) => [...o, group, ...children]));
    set({ selectedObjectId: gid, selectedObjectIds: [gid] });
    return gid;
  },
});
