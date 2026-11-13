// Shape tween slice 2 (spec 2026-11-13-shape-tween §Agent parity): headless builders, key-timing
// re-bake, DSL `tween` round-trip, describe, and the shape-tween-morph template.
import { describe, it, expect } from 'vitest';
import { createProject, samplePath } from '@savig/engine';
import type { FrameLayer, Project, SceneObject, VectorAsset } from '@savig/engine';
import { addEllipse, addRect } from './build';
import { addFrameKey, addFrameLayer, clearFrameKey, insertFrames, putInFrameKey, removeShapeTween, shapeTween } from './frames';
import { compileShort, decompileProject, type ShortDoc } from './dsl';
import { describeProject } from './describe';
import { validateProject } from './validate';
import { getTemplate } from './templates';

const base = () => createProject({ fps: 10, duration: 2, durationMode: 'manual' });
const layerOf = (p: Project) => p.objects.find((o) => o.id === 'L') as SceneObject & { frames: FrameLayer };
const obj = (p: Project, id: string) => p.objects.find((o) => o.id === id)!;

/** L: key a@0 holds rect `r`, key b@1 holds ellipse `e`, end 2. */
function twoKeys(): Project {
  let p = base();
  ({ project: p } = addFrameLayer(p, { id: 'L', keys: [{ id: 'a', time: 0 }, { id: 'b', time: 1 }], end: 2 }));
  ({ project: p } = addRect(p, { id: 'r', x: 0, y: 0, width: 10, height: 10, style: { fill: '#ff0000' } }));
  ({ project: p } = addEllipse(p, { id: 'e', x: 50, y: 0, width: 20, height: 20, style: { fill: '#0000ff' } }));
  return putInFrameKey(putInFrameKey(p, 'r', 'L', 'a'), 'e', 'L', 'b');
}

describe('shapeTween / removeShapeTween', () => {
  it('bakes by key id or by a time inside the span, with reproducible ids', () => {
    const byId = shapeTween(twoKeys(), 'L', 'a', { easing: 'easeIn' });
    const byTime = shapeTween(twoKeys(), 'L', 0.4, { easing: 'easeIn' });
    expect(byTime).toEqual(byId);
    expect(layerOf(byId).frames.keys[0].tween).toEqual({ kind: 'shape', easing: 'easeIn' });
    const r = obj(byId, 'r');
    expect(r.assetId).toBe('L-tw1');
    expect(r.shapeTrack!.map((k) => k.time)).toEqual([0, 1]);
    // the replaced rect asset is pruned
    expect(byId.assets.some((a) => a.id === obj(twoKeys(), 'r').assetId)).toBe(false);
    expect(validateProject(byId).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('fails loud on the last key, an unknown key, or removing nothing', () => {
    expect(() => shapeTween(twoKeys(), 'L', 'b')).toThrow(/following keyframe/);
    expect(() => shapeTween(twoKeys(), 'L', 'zz')).toThrow(/no key "zz"/);
    expect(() => removeShapeTween(twoKeys(), 'L', 'a')).toThrow(/no shape tween/);
  });

  it('remove leaves the start drawing static', () => {
    const p = removeShapeTween(shapeTween(twoKeys(), 'L', 'a'), 'L', 0);
    expect(obj(p, 'r').shapeTrack).toBeUndefined();
    expect(layerOf(p).frames.keys[0].tween).toBeUndefined();
  });

  it('key timing builders re-bake; F6 inside the tween splits it', () => {
    let p = insertFrames(shapeTween(twoKeys(), 'L', 'a'), 'L', 0, 5);
    expect(obj(p, 'r').shapeTrack!.map((k) => k.time)).toEqual([0, 1.5]);
    ({ project: p } = addFrameKey(p, 'L', { time: 0.5, id: 'mid', copyPrevious: true }));
    expect(layerOf(p).frames.keys.map((k) => !!k.tween)).toEqual([true, true, false]);
    expect(obj(p, 'r').shapeTrack!.map((k) => k.time)).toEqual([0, 0.5]);
    p = clearFrameKey(p, 'L', 'b');
    expect(layerOf(p).frames.keys.find((k) => k.id === 'mid')!.tween).toBeUndefined();
  });
});

describe('DSL tween', () => {
  const doc = (): ShortDoc => ({
    meta: { fps: 10, duration: 2 },
    objects: [
      {
        type: 'frames',
        id: 'L',
        end: 2,
        keys: [
          { time: 0, id: 'a', tween: { easing: 'easeOut' }, objects: [{ type: 'rect', id: 'r', x: 0, y: 0, width: 10, height: 10, style: { fill: '#ff0000' } }] },
          { time: 1, id: 'b', objects: [{ type: 'ellipse', id: 'e', x: 50, y: 0, width: 20, height: 20, style: { fill: '#0000ff' } }] },
        ],
      },
    ],
  });

  it('compiles a tweened key into a morph', () => {
    const p = compileShort(doc());
    expect(layerOf(p).frames.keys[0].tween).toEqual({ kind: 'shape', easing: 'easeOut' });
    const r = obj(p, 'r');
    const asset = p.assets.find((a) => a.id === r.assetId) as VectorAsset;
    expect(asset.shapeType).toBe('path');
    expect(samplePath(r.shapeTrack!, 0.5)).not.toEqual(r.shapeTrack![0].path);
  });

  it('decompiles the start drawing plus tween, and recompiles to the same project', () => {
    const p = compileShort(doc());
    const out = decompileProject(p);
    const frames = out.objects![0] as { keys: Array<{ tween?: unknown; objects: Array<{ type: string }> }> };
    expect(frames.keys[0].tween).toEqual({ easing: 'easeOut' });
    expect(frames.keys[0].objects.map((o) => o.type)).toEqual(['path']);
    expect(frames.keys[1].tween).toBeUndefined();
    const again = compileShort(out);
    expect(decompileProject(again)).toEqual(out);
    const r1 = obj(p, 'r');
    const r2 = obj(again, 'r');
    expect(r2.shapeTrack!.length).toBe(2);
    r2.shapeTrack![1].path.nodes.forEach((n, i) => {
      expect(n.anchor.x).toBeCloseTo(r1.shapeTrack![1].path.nodes[i].anchor.x);
      expect(n.anchor.y).toBeCloseTo(r1.shapeTrack![1].path.nodes[i].anchor.y);
    });
  });

  it('a grown drawing is not written out (compile re-creates it)', () => {
    const d = doc();
    (d.objects![0] as { keys: Array<{ objects: unknown[] }> }).keys[0].objects = [];
    const p = compileShort(d);
    expect(p.objects.filter((o) => o.frameKeyId === 'a')).toHaveLength(1);
    const out = decompileProject(p);
    expect((out.objects![0] as { keys: Array<{ objects: unknown[] }> }).keys[0].objects).toEqual([]);
  });

  it('rejects a malformed tween', () => {
    const d = doc();
    (d.objects![0] as { keys: Array<{ tween?: unknown }> }).keys[0].tween = 'motion';
    expect(() => compileShort(d)).toThrow(/tween must be/);
  });
});

describe('describe + template', () => {
  it('marks tweened keys', () => {
    const text = describeProject(shapeTween(twoKeys(), 'L', 'a', { easing: 'easeInOut' }));
    expect(text).toMatch(/a 0–1s 1 obj →tween\(easeInOut\)/);
  });

  it('shape-tween-morph builds a valid two-tween layer', () => {
    const p = getTemplate('shape-tween-morph')!.build();
    expect(layerOf({ ...p, objects: p.objects.map((o) => (o.id === 'morph' ? { ...o, id: 'L' } : o)) }).frames.keys.map((k) => !!k.tween)).toEqual([true, true, false]);
    expect(validateProject(p).filter((i) => i.severity === 'error')).toEqual([]);
  });
});
