// Frame-by-frame slice 6 (spec 2026-11-07 §DSL / MCP / macros): headless builders, flipbook,
// DSL round-trip, describe, and the "bouncing ball on twos" template.
import { describe, it, expect } from 'vitest';
import { computeProjectDuration, createProject, exposedFrameKeyId } from '@savig/engine';
import type { FrameLayer, Project, SceneObject } from '@savig/engine';
import { addEllipse, addRect } from './build';
import {
  addFrameKey,
  addFrameLayer,
  clearFrameKey,
  flipbook,
  frameKeyAtTime,
  insertFrames,
  putInFrameKey,
  removeFrames,
} from './frames';
import { compileShort, decompileProject, type ShortDoc, type ShortFrames } from './dsl';
import { describeProject } from './describe';
import { validateProject } from './validate';
import { getTemplate } from './templates';

const FPS = 10;
const f = (n: number) => n / FPS;
const base = () => createProject({ fps: FPS, duration: 2, durationMode: 'manual' });
const layerOf = (p: Project, id = 'L') => p.objects.find((o) => o.id === id) as SceneObject & { frames: FrameLayer };
const keyTimes = (p: Project, id = 'L') => layerOf(p, id).frames.keys.map((k) => k.time);
const drawingAt = (p: Project, t: number, id = 'L') => {
  const keyId = exposedFrameKeyId(layerOf(p, id).frames, t);
  return p.objects.filter((o) => o.parentId === id && o.frameKeyId === keyId).map((o) => o.id);
};
const errors = (p: Project) => validateProject(p).filter((i) => i.severity === 'error');

describe('addFrameLayer', () => {
  it('defaults to one key at 0 lasting one frame, at the origin', () => {
    const { project, id } = addFrameLayer(base(), { id: 'L' });
    const L = layerOf(project);
    expect(id).toBe('L');
    expect(L.isGroup).toBe(true);
    expect(L.frames.keys.map((k) => k.time)).toEqual([0]);
    expect(L.frames.end).toBeCloseTo(f(1));
    expect([L.base.x, L.base.y]).toEqual([0, 0]);
    expect(errors(project)).toEqual([]);
  });

  it('snaps and sorts keys, keeps labels, places the layer', () => {
    const { project } = addFrameLayer(base(), { id: 'L', x: 40, y: 20, keys: [{ time: 0.31, label: ' b ' }, { time: 0 }], end: 1 });
    const L = layerOf(project);
    expect(L.frames.keys.map((k) => k.time)).toEqual([0, f(3)]);
    expect(L.frames.keys[1].label).toBe('b');
    expect(L.frames.end).toBeCloseTo(1);
    expect([L.base.x, L.base.y]).toEqual([40, 20]);
  });

  it('fails loud on duplicate key times, an early end, or a taken id', () => {
    expect(() => addFrameLayer(base(), { keys: [{ time: 0.1 }, { time: 0.1 }] })).toThrow(/two keys/);
    expect(() => addFrameLayer(base(), { keys: [{ time: 0.5 }], end: 0.5 })).toThrow(/after the last key/);
    const { project } = addRect(base(), { id: 'L', x: 0, y: 0, width: 1, height: 1 });
    expect(() => addFrameLayer(project, { id: 'L' })).toThrow(/already exists/);
  });
});

describe('keys and drawings', () => {
  it('frameKeyAtTime reuses the key starting there, else creates a blank one', () => {
    const { project: p0 } = addFrameLayer(base(), { id: 'L' });
    const first = layerOf(p0).frames.keys[0].id;
    expect(frameKeyAtTime(p0, 'L', 0).id).toBe(first);
    const { project: p, id } = frameKeyAtTime(p0, 'L', f(4));
    expect(id).not.toBe(first);
    expect(keyTimes(p)).toEqual([0, f(4)]);
    expect(layerOf(p).frames.end).toBeCloseTo(f(5));
  });

  it('putInFrameKey files a top-level object; refuses nested objects and unknown keys', () => {
    let { project: p } = addFrameLayer(base(), { id: 'L' });
    ({ project: p } = addRect(p, { id: 'r', x: 0, y: 0, width: 5, height: 5 }));
    const key = layerOf(p).frames.keys[0].id;
    p = putInFrameKey(p, 'r', 'L', key);
    expect(drawingAt(p, 0)).toEqual(['r']);
    expect(() => putInFrameKey(p, 'r', 'L', key)).toThrow(/not a top-level/);
    expect(() => putInFrameKey(p, 'L', 'L', key)).toThrow(/own key/);
    ({ project: p } = addRect(p, { id: 's', x: 0, y: 0, width: 5, height: 5 }));
    expect(() => putInFrameKey(p, 's', 'L', 'nope')).toThrow(/no key/);
    expect(errors(p)).toEqual([]);
  });

  it('addFrameKey: blank (F7) or a deep copy of the previous drawing (F6)', () => {
    let { project: p } = addFrameLayer(base(), { id: 'L', end: f(2) });
    ({ project: p } = addEllipse(p, { id: 'ball', x: 10, y: 10, width: 20, height: 20 }));
    p = putInFrameKey(p, 'ball', 'L', layerOf(p).frames.keys[0].id);
    ({ project: p } = addFrameKey(p, 'L', { time: f(2), id: 'blank' }));
    expect(drawingAt(p, f(2))).toEqual([]);
    ({ project: p } = addFrameKey(p, 'L', { time: f(4), copyPrevious: true, label: 'copy' }));
    const copy = drawingAt(p, f(4));
    expect(copy).toHaveLength(0); // the drawing shown just before f(4) is the blank key's
    ({ project: p } = addFrameKey(p, 'L', { time: f(1), copyPrevious: true, id: 'k1' }));
    const copied = drawingAt(p, f(1));
    expect(copied).toHaveLength(1);
    expect(copied[0]).not.toBe('ball');
    const c = p.objects.find((o) => o.id === copied[0])!;
    expect(c.base.x).toBe(10);
    expect(c.assetId).not.toBe(p.objects.find((o) => o.id === 'ball')!.assetId); // own asset
    expect(() => addFrameKey(p, 'L', { time: f(1) })).toThrow(/already has a key/);
    expect(errors(p)).toEqual([]);
  });

  it('insert / remove frames shift later keys; a collapsed key loses its drawing', () => {
    let { project: p } = addFrameLayer(base(), { id: 'L', keys: [{ time: 0 }, { time: f(1), id: 'b' }], end: f(3) });
    ({ project: p } = addRect(p, { id: 'r', x: 0, y: 0, width: 5, height: 5 }));
    p = putInFrameKey(p, 'r', 'L', 'b');
    p = insertFrames(p, 'L', 0, 2);
    expect(keyTimes(p)).toEqual([0, f(3)]);
    expect(layerOf(p).frames.end).toBeCloseTo(f(5));
    p = removeFrames(p, 'L', f(3), 2);
    expect(keyTimes(p)).toEqual([0]);
    expect(p.objects.some((o) => o.id === 'r')).toBe(false);
    expect(() => removeFrames(p, 'L', f(40))).toThrow(/cannot remove/);
  });

  it('clearFrameKey drops the key and its drawing', () => {
    let { project: p } = addFrameLayer(base(), { id: 'L', keys: [{ time: 0 }, { time: f(2), id: 'b' }] });
    ({ project: p } = addRect(p, { id: 'r', x: 0, y: 0, width: 5, height: 5 }));
    p = putInFrameKey(p, 'r', 'L', 'b');
    p = clearFrameKey(p, 'L', 'b');
    expect(keyTimes(p)).toEqual([0]);
    expect(p.objects.map((o) => o.id)).toEqual(['L']);
    expect(p.assets).toEqual([]);
  });

  it('builders refuse a non-layer', () => {
    const { project } = addRect(base(), { id: 'r', x: 0, y: 0, width: 5, height: 5 });
    expect(() => insertFrames(project, 'r', 0)).toThrow(/not a frame-by-frame layer/);
    expect(() => insertFrames(project, 'zz', 0)).toThrow(/no object/);
  });
});

describe('flipbook', () => {
  const drawn = () => {
    let { project: p } = addFrameLayer(base(), { id: 'L' });
    for (const id of ['a', 'b', 'c']) ({ project: p } = addRect(p, { id, x: 0, y: 0, width: 5, height: 5 }));
    return p;
  };

  it('one drawing per frame by default', () => {
    const p = flipbook(drawn(), 'L', [['a'], ['b'], ['c']]);
    expect(keyTimes(p)).toEqual([0, f(1), f(2)]);
    expect(layerOf(p).frames.end).toBeCloseTo(f(3));
    expect([0, 1, 2].map((n) => drawingAt(p, f(n)))).toEqual([['a'], ['b'], ['c']]);
    expect(layerOf(p).frames.keys.map((k) => k.id)).toEqual(['L-k0', 'L-k1', 'L-k2']);
    expect(errors(p)).toEqual([]);
  });

  it('on twos from a start time', () => {
    const p = flipbook(drawn(), 'L', [['a', 'b'], ['c']], { hold: 2, start: f(1) });
    expect(keyTimes(p)).toEqual([f(1), f(3)]);
    expect(layerOf(p).frames.end).toBeCloseTo(f(5));
    expect(drawingAt(p, f(2)).sort()).toEqual(['a', 'b']);
    expect(drawingAt(p, f(4))).toEqual(['c']);
  });

  it('refuses an empty list, a layer that already has drawings, or unknown ids', () => {
    expect(() => flipbook(drawn(), 'L', [])).toThrow(/at least one/);
    const once = flipbook(drawn(), 'L', [['a']]);
    expect(() => flipbook(once, 'L', [['b']])).toThrow(/already has drawings/);
    expect(() => flipbook(drawn(), 'L', [['zz']])).toThrow(/no object/);
  });
});

describe('DSL', () => {
  const doc: ShortDoc = {
    meta: { fps: FPS, width: 200, height: 100 },
    objects: [
      { type: 'rect', id: 'bg', x: 0, y: 0, width: 200, height: 100 },
      {
        type: 'frames',
        id: 'L',
        name: 'Ball',
        x: 20,
        end: 0.4,
        keys: [
          { time: 0, id: 'k0', label: 'up', objects: [{ type: 'ellipse', id: 'b0', x: 0, y: 0, width: 10, height: 10 }] },
          { time: 0.2, id: 'k1', objects: [{ type: 'ellipse', id: 'b1', x: 0, y: 50, width: 12, height: 8 }] },
        ],
      },
    ],
  };

  it('compiles a frames object into a layer with keyed drawings in layer space', () => {
    const p = compileShort(doc);
    expect(keyTimes(p)).toEqual([0, f(2)]);
    expect(layerOf(p).base.x).toBe(20);
    expect(drawingAt(p, 0)).toEqual(['b0']);
    expect(drawingAt(p, f(3))).toEqual(['b1']);
    expect(p.objects.find((o) => o.id === 'b1')!.base.y).toBe(50);
    expect(errors(p)).toEqual([]);
    expect(computeProjectDuration(p)).toBeCloseTo(0.4);
  });

  it('round-trips: decompile emits the layer once, not its drawings at the top level', () => {
    const p = compileShort(doc);
    const back = decompileProject(p);
    expect(back.objects!.map((o) => o.id)).toEqual(['bg', 'L']);
    const fr = back.objects![1] as ShortFrames;
    expect(fr).toMatchObject({ type: 'frames', id: 'L', name: 'Ball', x: 20, end: 0.4 });
    expect(fr.keys.map((k) => [k.id, k.time, k.label, k.objects.map((o) => o.id)])).toEqual([
      ['k0', 0, 'up', ['b0']],
      ['k1', 0.2, undefined, ['b1']],
    ]);
    expect(compileShort(back)).toEqual(p);
  });

  it('fails loud on an empty keys array or nested frames', () => {
    expect(() => compileShort({ objects: [{ type: 'frames', keys: [] }] })).toThrow(/non-empty keys/);
    expect(() =>
      compileShort({ objects: [{ type: 'frames', keys: [{ time: 0, objects: [{ type: 'frames', keys: [] } as never] }] }] }),
    ).toThrow(/cannot nest/);
  });
});

describe('describe', () => {
  it('lists each key with its span and drawing count', () => {
    const p = compileShort({
      meta: { fps: FPS },
      objects: [{ type: 'frames', id: 'L', end: 0.5, keys: [{ time: 0, id: 'k0', label: 'hit', objects: [{ type: 'rect', x: 0, y: 0, width: 1, height: 1 }] }, { time: 0.3, id: 'k1', objects: [] }] }],
    });
    const text = describeProject(p);
    expect(text).toContain('(frames)');
    expect(text).toContain('frames end=0.5s keys: k0 "hit" 0–0.3s 1 obj, k1 0.3–0.5s blank');
    expect(text).toContain('key=k0');
  });
});

describe('bouncing-ball-on-twos template', () => {
  it('is a 12-drawing frame layer held two frames apiece at 24 fps, squashing at the floor', () => {
    const p = getTemplate('bouncing-ball-on-twos')!.build();
    expect(p.meta.fps).toBe(24);
    const L = layerOf(p, 'bounce');
    expect(L.frames.keys).toHaveLength(12);
    expect(L.frames.keys[1].time).toBeCloseTo(2 / 24);
    expect(L.frames.end).toBeCloseTo(1);
    expect(drawingAt(p, 0, 'bounce')).toEqual(['ball0']);
    expect(drawingAt(p, 13 / 24, 'bounce')).toEqual(['ball6']);
    const floor = p.objects.find((o) => o.id === 'ball6')!;
    const apex = p.objects.find((o) => o.id === 'ball0')!;
    expect(floor.base.y).toBeGreaterThan(apex.base.y);
    expect(floor.shapeBase!.radiusX!).toBeGreaterThan(floor.shapeBase!.radiusY!);
  });
});
