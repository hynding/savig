import { describe, it, expect } from 'vitest';
import { computeProjectDuration, createProject } from '@savig/engine';
import type { AudioAsset } from '@savig/engine';
import { describeProject } from './describe';
import { validateProject } from './validate';
import { compileShort, decompileProject, type ShortDoc } from './dsl';
import { addAudioTrack, addAudioClip, setClipFades, addBehavior, setVariable } from './build';

const doc: ShortDoc = {
  meta: { name: 'Slide', width: 640, height: 360, fps: 30 },
  objects: [
    {
      type: 'rect',
      id: 'box',
      x: 100,
      y: 160,
      width: 80,
      height: 80,
      style: { fill: '#3366ff' },
      base: { rotation: 15 },
      animate: {
        x: [
          { t: 0, value: 100 },
          { t: 2, value: 460, easing: 'easeInOut' },
        ],
      },
    },
    { type: 'ellipse', id: 'dot', x: 10, y: 10, width: 40, height: 20 },
  ],
};

describe('core/dsl compileShort', () => {
  it('compiles a declarative short into a Project', () => {
    const p = compileShort(doc);
    expect(p.meta.name).toBe('Slide');
    expect(p.meta.width).toBe(640);
    expect(p.objects.map((o) => o.id)).toEqual(['box', 'dot']);
    const box = p.objects.find((o) => o.id === 'box')!;
    expect(box.base.rotation).toBe(15);
    expect(box.tracks.x!.map((k) => k.time)).toEqual([0, 2]);
    expect(box.tracks.x![1].easing).toBe('easeInOut');
    expect(computeProjectDuration(p)).toBe(2);
    expect(validateProject(p)).toEqual([]);
    expect(describeProject(p)).toContain('"Slide"');
  });

  it('throws on an unknown object type', () => {
    expect(() => compileShort({ objects: [{ type: 'blob' } as never] })).toThrow(/unknown object type/);
  });

  it('throws when objects is missing', () => {
    expect(() => compileShort({} as ShortDoc)).toThrow(/objects must be an array/);
  });

  it('throws on a typo\'d animate property key', () => {
    expect(() =>
      compileShort({
        objects: [
          {
            type: 'rect',
            id: 'box',
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            animate: { xPos: [{ t: 0, value: 0 }] } as never,
          },
        ],
      }),
    ).toThrow(/savig\/core: unknown animatable property "xPos"/);
  });
});

describe('core/dsl round-trip', () => {
  it('decompile→compile reproduces an equivalent project (rect/ellipse + base + animate)', () => {
    const p1 = compileShort(doc);
    const p2 = compileShort(decompileProject(p1));
    // Equivalent: same object ids, base transforms, geometry, and tracks.
    expect(p2.objects.map((o) => o.id)).toEqual(p1.objects.map((o) => o.id));
    for (const o1 of p1.objects) {
      const o2 = p2.objects.find((o) => o.id === o1.id)!;
      expect(o2.base).toEqual(o1.base);
      expect(o2.shapeBase).toEqual(o1.shapeBase);
      expect(o2.tracks).toEqual(o1.tracks);
    }
  });

  it('round-trips a path object (position carried in base)', () => {
    const pathDoc: ShortDoc = {
      objects: [{ type: 'path', id: 'p', path: { closed: false, nodes: [{ anchor: { x: 30, y: 40 } }, { anchor: { x: 80, y: 90 } }] } }],
    };
    const p1 = compileShort(pathDoc);
    const p2 = compileShort(decompileProject(p1));
    const a1 = p1.objects.find((o) => o.id === 'p')!;
    const a2 = p2.objects.find((o) => o.id === 'p')!;
    expect(a2.base.x).toBe(a1.base.x);
    expect(a2.base.y).toBe(a1.base.y);
    const path1 = p1.assets.find((a) => a.id === a1.assetId);
    const path2 = p2.assets.find((a) => a.id === a2.assetId);
    expect(path2!.kind === 'vector' && path2!.path).toEqual(path1!.kind === 'vector' ? path1!.path : undefined);
  });

  it('skips non-DSL objects (groups) on decompile', () => {
    const p = compileShort(doc);
    const withGroup = { ...p, objects: [...p.objects, { ...p.objects[0], id: 'g', isGroup: true, assetId: '' }] };
    const back = decompileProject(withGroup);
    expect(back.objects!.map((o) => o.id)).toEqual(['box', 'dot']); // group skipped
  });
});

describe('core/dsl anchor', () => {
  const limbPath = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 0, y: 40 } }] };

  it('compiles an anchor onto the object, keeping the builder anchorMode when mode is omitted', () => {
    const p = compileShort({ objects: [{ type: 'path', id: 'limb', path: limbPath, anchor: { x: 0.5, y: 0 } }] });
    const limb = p.objects.find((o) => o.id === 'limb')!;
    // pivot at the top of the segment (a joint), still in the builder's fraction mode
    expect([limb.anchorX, limb.anchorY, limb.anchorMode]).toEqual([0.5, 0, 'fraction']);
  });

  it('compiles an absolute-mode anchor', () => {
    const p = compileShort({ objects: [{ type: 'rect', id: 'r', x: 0, y: 0, width: 10, height: 10, anchor: { x: 5, y: 10, mode: 'absolute' } }] });
    const r = p.objects.find((o) => o.id === 'r')!;
    expect([r.anchorX, r.anchorY, r.anchorMode]).toEqual([5, 10, 'absolute']);
  });

  it('decompile emits anchor only when it differs from the builder default', () => {
    const p = compileShort({
      objects: [
        { type: 'rect', id: 'plain', x: 0, y: 0, width: 10, height: 10 },
        { type: 'rect', id: 'pivoted', x: 0, y: 0, width: 10, height: 10, anchor: { x: 1, y: 1 } },
      ],
    });
    const back = decompileProject(p);
    const plain = back.objects!.find((o) => o.id === 'plain')!;
    const pivoted = back.objects!.find((o) => o.id === 'pivoted')!;
    expect('anchor' in plain).toBe(false);
    expect(pivoted.anchor).toEqual({ x: 1, y: 1 }); // same mode as builder default → mode omitted
  });

  it('round-trips a joint-pivoted path (compile→decompile→compile)', () => {
    const p1 = compileShort({ objects: [{ type: 'path', id: 'limb', path: limbPath, anchor: { x: 0.5, y: 0 } }] });
    const p2 = compileShort(decompileProject(p1));
    const a1 = p1.objects.find((o) => o.id === 'limb')!;
    const a2 = p2.objects.find((o) => o.id === 'limb')!;
    expect([a2.anchorX, a2.anchorY, a2.anchorMode]).toEqual([a1.anchorX, a1.anchorY, a1.anchorMode]);
  });
});

describe('core/dsl trim', () => {
  it('compiles trim base values onto the object', () => {
    const p = compileShort({
      objects: [{ type: 'rect', id: 'r', x: 0, y: 0, width: 10, height: 10, trim: { end: 0.5 } }],
    });
    const r = p.objects.find((o) => o.id === 'r')!;
    expect(r.trim?.end).toBe(0.5);
    expect(r.trim?.start).toBe(0);
  });

  it('compiles trim keyframe tracks', () => {
    const p = compileShort({
      objects: [
        {
          type: 'rect',
          id: 'r',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          trim: { animate: { end: [{ t: 0, value: 0 }, { t: 1, value: 1 }] } },
        },
      ],
    });
    const r = p.objects.find((o) => o.id === 'r')!;
    expect(r.trim?.endTrack?.map((k) => k.time)).toEqual([0, 1]);
    expect(r.trim?.endTrack?.map((k) => k.value)).toEqual([0, 1]);
  });

  it('decompileProject(compileShort(doc)) round-trips the trim subtree', () => {
    const trimDoc: ShortDoc = {
      objects: [
        {
          type: 'rect',
          id: 'r',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          trim: {
            start: 0.1,
            end: 0.9,
            animate: {
              offset: [
                { t: 0, value: 0 },
                { t: 1, value: 1, easing: 'easeInOut' },
              ],
            },
          },
        },
      ],
    };
    const p1 = compileShort(trimDoc);
    const doc2 = decompileProject(p1);
    const obj2 = doc2.objects!.find((o) => o.id === 'r')!;
    expect(obj2.trim).toEqual(trimDoc.objects![0].trim);

    const p2 = compileShort(doc2);
    const r1 = p1.objects.find((o) => o.id === 'r')!;
    const r2 = p2.objects.find((o) => o.id === 'r')!;
    expect(r2.trim).toEqual(r1.trim);
  });

  it('objects without trim have no trim field after decompile', () => {
    const back = decompileProject(compileShort(doc));
    const box = back.objects!.find((o) => o.id === 'box')!;
    expect(box.trim).toBeUndefined();
  });
});

describe('core/dsl repeat', () => {
  it('compiles a repeat spec onto the object, normalized', () => {
    const p = compileShort({
      objects: [{ type: 'rect', id: 'r', x: 0, y: 0, width: 10, height: 10, repeat: { count: 3, dx: 10, dy: 0, rotate: 0, scale: 1, stagger: 0 } }],
    });
    const r = p.objects.find((o) => o.id === 'r')!;
    expect(r.repeat).toEqual({ count: 3, dx: 10, dy: 0, rotate: 0, scale: 1, stagger: 0 });
  });

  it('decompileProject(compileShort(doc)) round-trips the repeat subtree', () => {
    const repeatDoc: ShortDoc = {
      objects: [
        {
          type: 'rect',
          id: 'r',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          repeat: { count: 5, dx: 12, dy: -4, rotate: 15, scale: 0.9, stagger: 0.2 },
        },
      ],
    };
    const p1 = compileShort(repeatDoc);
    const doc2 = decompileProject(p1);
    const obj2 = doc2.objects!.find((o) => o.id === 'r')!;
    expect(obj2.repeat).toEqual(repeatDoc.objects![0].repeat);

    const p2 = compileShort(doc2);
    const r1 = p1.objects.find((o) => o.id === 'r')!;
    const r2 = p2.objects.find((o) => o.id === 'r')!;
    expect(r2.repeat).toEqual(r1.repeat);
  });

  it('objects without repeat have no repeat field after decompile', () => {
    const back = decompileProject(compileShort(doc));
    const box = back.objects!.find((o) => o.id === 'box')!;
    expect(box.repeat).toBeUndefined();
  });
});

const sceneDoc: ShortDoc = {
  meta: { name: 'Multi', width: 100, height: 100, fps: 30 },
  scenes: [
    { name: 'A', duration: 2, objects: [{ type: 'rect', x: 0, y: 0, width: 10, height: 10, id: 'a1' }] },
    { name: 'B', duration: 1.5, transitionIn: { kind: 'crossfade', duration: 0.5 },
      objects: [{ type: 'ellipse', x: 5, y: 5, width: 20, height: 20, id: 'b1' }] },
  ],
};

describe('core/dsl multi-scene', () => {
  it('compileShort builds Project.scenes and leaves objects empty', () => {
    const p = compileShort(sceneDoc);
    expect(p.objects).toEqual([]);
    expect(p.scenes!.map((s) => s.name)).toEqual(['A', 'B']);
    expect(p.scenes![0].duration).toBe(2);
    expect(p.scenes![1].transitionIn).toEqual({ kind: 'crossfade', duration: 0.5 });
    expect(p.scenes![0].objects.map((o) => o.id)).toEqual(['a1']);
    expect(p.assets.some((a) => a.id === 'a1-asset')).toBe(true); // assets global across scenes
    expect(p.assets.some((a) => a.id === 'b1-asset')).toBe(true);
  });

  it('compileShort fails loud when objects and scenes are both present', () => {
    expect(() => compileShort({ objects: [{ type: 'rect', x: 0, y: 0, width: 1, height: 1 }], scenes: [] } as ShortDoc))
      .toThrow();
  });

  it('decompileProject emits scenes; round-trips stably', () => {
    const p1 = compileShort(sceneDoc);
    const doc2 = decompileProject(p1);
    expect(doc2.scenes).toBeDefined();
    expect(doc2.objects).toBeUndefined();
    const p2 = compileShort(doc2);
    expect(p2.scenes!.map((s) => ({ name: s.name, duration: s.duration }))).toEqual(p1.scenes!.map((s) => ({ name: s.name, duration: s.duration })));
    for (let i = 0; i < p1.scenes!.length; i++) {
      expect(p2.scenes![i].objects.map((o) => ({ base: o.base, shapeBase: o.shapeBase }))).toEqual(
        p1.scenes![i].objects.map((o) => ({ base: o.base, shapeBase: o.shapeBase })),
      );
      expect(p2.scenes![i].transitionIn).toEqual(p1.scenes![i].transitionIn);
    }
  });

  it('single-scene doc still compiles/decompiles unchanged (parity)', () => {
    const doc2: ShortDoc = { meta: { name: 'S' }, objects: [{ type: 'rect', x: 1, y: 2, width: 3, height: 4, id: 'r' }] };
    const round = decompileProject(compileShort(doc2));
    expect(round.scenes).toBeUndefined();
    expect(round.objects!.map((o) => o.id)).toEqual(['r']);
  });
});

// --- Task 5 (animatable-primitives): DSL pin — `animate.starPoints` is a generic AnimatableProperty,
// so it compiles into `obj.tracks.starPoints` (and round-trips via decompile) with no DSL-specific
// support needed for the star/polygon primitive kinds themselves. Uses a plain `path` object since
// the v1 DSL builders (rect/ellipse/path/text) don't include a primitive-shape constructor — the
// point being pinned is the generic keyframe-track plumbing, not primitive stamping. ---
describe('core/dsl animatable primitives', () => {
  const starPointsDoc: ShortDoc = {
    objects: [
      {
        type: 'path',
        id: 'star',
        path: { closed: true, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 5, y: 10 } }] },
        animate: {
          starPoints: [
            { t: 0, value: 5 },
            { t: 1.5, value: 9, easing: 'easeInOut' },
          ],
        },
      },
    ],
  };

  it('animate.starPoints compiles into obj.tracks.starPoints', () => {
    const p = compileShort(starPointsDoc);
    const star = p.objects.find((o) => o.id === 'star')!;
    expect(star.tracks.starPoints!.map((k) => k.time)).toEqual([0, 1.5]);
    expect(star.tracks.starPoints!.map((k) => k.value)).toEqual([5, 9]);
    expect(star.tracks.starPoints![1].easing).toBe('easeInOut');
  });

  it('a starPoints track round-trips through decompile -> compile', () => {
    const p1 = compileShort(starPointsDoc);
    const p2 = compileShort(decompileProject(p1));
    const star1 = p1.objects.find((o) => o.id === 'star')!;
    const star2 = p2.objects.find((o) => o.id === 'star')!;
    expect(star2.tracks.starPoints).toEqual(star1.tracks.starPoints);
  });
});

describe('core/dsl audio', () => {
  const audioAsset: AudioAsset = { id: 'a1', kind: 'audio', name: 'a1', mimeType: 'audio/mpeg', duration: 10 };

  it('compiles tracks with nested clips + top-level default-lane clips', () => {
    const p = compileShort({
      meta: {},
      objects: [],
      audio: {
        tracks: [
          {
            id: 't1', name: 'Music', gain: 0.5, pan: 0.3, filter: { kind: 'lowpass', frequency: 500 },
            clips: [{ id: 'c1', asset: 'a1', at: 0, in: 0, out: 5, volume: 0.8, fadeIn: 1, fadeOut: 1 }],
          },
        ],
        clips: [{ id: 'c2', asset: 'a1', at: 1, in: 0, out: 2 }],
      },
    });
    expect(p.audioTracks).toEqual([
      { id: 't1', name: 'Music', gain: 0.5, muted: false, solo: false, pan: 0.3, filter: { kind: 'lowpass', frequency: 500 } },
    ]);
    expect(p.audioClips).toEqual([
      { id: 'c1', assetId: 'a1', trackId: 't1', startTime: 0, inPoint: 0, outPoint: 5, volume: 0.8, fadeIn: 1, fadeOut: 1 },
      { id: 'c2', assetId: 'a1', startTime: 1, inPoint: 0, outPoint: 2, volume: 1 },
    ]);
  });

  it('a doc without audio compiles to a project with no audioTracks/empty audioClips (parity)', () => {
    const p = compileShort({ meta: {}, objects: [] });
    expect(p.audioTracks).toBeUndefined();
    expect(p.audioClips).toEqual([]);
  });

  it('decompile emits audio only when clips or tracks exist', () => {
    const empty = compileShort({ meta: {}, objects: [] });
    expect(decompileProject(empty).audio).toBeUndefined();

    let p = createProject();
    p = { ...p, assets: [...p.assets, audioAsset] };
    ({ project: p } = addAudioClip(p, { assetId: 'a1', at: 0, inPoint: 0, outPoint: 1, id: 'c1' }));
    expect(decompileProject(p).audio).toBeDefined();
  });

  it('round-trip: 1 track (pan+filter) + 1 tracked fading clip + 1 default-lane clip', () => {
    let p = createProject();
    p = { ...p, assets: [...p.assets, audioAsset] };
    const addedTrack = addAudioTrack(p, { name: 'Music', gain: 0.5, pan: 0.3, filter: { kind: 'lowpass', frequency: 500 } });
    p = addedTrack.project;
    const trackId = addedTrack.id;
    const addedClip = addAudioClip(p, { assetId: 'a1', trackId, at: 0, inPoint: 0, outPoint: 5, volume: 0.8 });
    p = addedClip.project;
    const clipId = addedClip.id;
    p = setClipFades(p, clipId, { fadeIn: 1, fadeOut: 1 });
    ({ project: p } = addAudioClip(p, { assetId: 'a1', at: 6, inPoint: 0, outPoint: 2 }));

    const recompiled = compileShort(decompileProject(p));
    expect(recompiled.audioTracks).toEqual(p.audioTracks);
    expect(recompiled.audioClips).toEqual(p.audioClips);
  });

  it('interleaved lanes: clip order is canonical (startTime, then id) on both sides, so round-trips are stable', () => {
    // Author clips in an order the per-track grouping can NOT reproduce by luck: the flat array
    // interleaves two tracks + the default lane, and within a track later clips come first.
    let p = createProject();
    p = { ...p, assets: [...p.assets, audioAsset] };
    const t1 = addAudioTrack(p, { name: 'T1' });
    p = t1.project;
    const t2 = addAudioTrack(p, { name: 'T2' });
    p = t2.project;
    ({ project: p } = addAudioClip(p, { assetId: 'a1', trackId: t2.id, at: 3, inPoint: 0, outPoint: 1, id: 'c-t2' }));
    ({ project: p } = addAudioClip(p, { assetId: 'a1', at: 2, inPoint: 0, outPoint: 1, id: 'c-def' }));
    ({ project: p } = addAudioClip(p, { assetId: 'a1', trackId: t1.id, at: 5, inPoint: 0, outPoint: 1, id: 'c-t1-late' }));
    ({ project: p } = addAudioClip(p, { assetId: 'a1', trackId: t1.id, at: 0, inPoint: 0, outPoint: 1, id: 'c-t1-early' }));

    // Decompile emits every clip list in (at, id) order — canonical DSL text on the FIRST pass.
    const doc = decompileProject(p);
    expect(doc.audio!.tracks![0].clips!.map((c) => c.id)).toEqual(['c-t1-early', 'c-t1-late']);
    expect(doc.audio!.clips!.map((c) => c.id)).toEqual(['c-def']);

    // Compile lands the flat array in (startTime, id) order — deterministic, lane-independent.
    const once = compileShort(doc);
    expect(once.audioClips.map((c) => c.id)).toEqual(['c-t1-early', 'c-def', 'c-t2', 'c-t1-late']);
    expect(new Set(once.audioClips.map((c) => c.id))).toEqual(new Set(p.audioClips.map((c) => c.id)));

    // From the first pass on, both the DSL text and the project are fixed points.
    expect(decompileProject(once)).toEqual(doc);
    expect(compileShort(decompileProject(once))).toEqual(once);
  });
});

describe('core/dsl interactions (M9)', () => {
  it('compiles object behaviors (in array order, right after the object) + a global handler + variables', () => {
    const p = compileShort({
      meta: {},
      objects: [
        {
          type: 'rect', id: 'r', x: 0, y: 0, width: 10, height: 10,
          behaviors: [{ id: 'b1', event: 'click', actions: [{ kind: 'setVar', args: { name: 'score', value: 'score + 1' } }] }],
        },
      ],
      interactions: {
        variables: [{ name: 'score', initial: 0 }],
        handlers: [{ id: 'h1', event: 'keydown', key: 'ArrowLeft', actions: [{ kind: 'setPosition', args: { targetId: 'r', dx: '-10' }, if: 'score > 0' }] }],
      },
    });
    expect(p.objects.find((o) => o.id === 'r')!.behaviors).toEqual([
      { id: 'b1', event: 'click', actions: [{ kind: 'setVar', args: { name: 'score', value: 'score + 1' } }] },
    ]);
    expect(p.interactions).toEqual({
      variables: [{ name: 'score', initial: 0 }],
      handlers: [{ id: 'h1', event: 'keydown', key: 'ArrowLeft', actions: [{ kind: 'setPosition', args: { targetId: 'r', dx: '-10' }, if: 'score > 0' }] }],
    });
  });

  it('a doc without interactions compiles to a project with no interactions field (parity)', () => {
    const p = compileShort({ meta: {}, objects: [] });
    expect(p.interactions).toBeUndefined();
  });

  it('a rect with no behaviors has no behaviors field (parity)', () => {
    const p = compileShort({ meta: {}, objects: [{ type: 'rect', id: 'r', x: 0, y: 0, width: 10, height: 10 }] });
    expect(p.objects[0].behaviors).toBeUndefined();
  });

  it('decompile emits interactions only when a variable or handler exists', () => {
    const empty = compileShort({ meta: {}, objects: [] });
    expect(decompileProject(empty).interactions).toBeUndefined();

    let p = createProject();
    p = setVariable(p, 'x', 1);
    expect(decompileProject(p).interactions).toBeDefined();
  });

  it('round-trip: object behavior + global handler + variables — compileShort(decompileProject(p)) deep-equals interactions + behaviors', () => {
    let p = compileShort({
      meta: {},
      objects: [{ type: 'rect', id: 'r', x: 0, y: 0, width: 10, height: 10 }],
    });
    p = setVariable(p, 'score', 0);
    p = setVariable(p, 'label', 'hi');
    ({ project: p } = addBehavior(p, 'r', { id: 'b1', event: 'click', actions: [{ kind: 'setVar', args: { name: 'score', value: 'score + 1' } }] }));
    ({ project: p } = addBehavior(p, 'r', { id: 'b2', event: 'hoverEnter', actions: [{ kind: 'setOpacity', args: { value: '0.5' } }] }));
    ({ project: p } = addBehavior(p, null, { id: 'h1', event: 'keydown', key: 'ArrowLeft', actions: [{ kind: 'setPosition', args: { targetId: 'r', dx: '-10' }, if: 'score > 0' }] }));

    const recompiled = compileShort(decompileProject(p));
    expect(recompiled.interactions).toEqual(p.interactions);
    expect(recompiled.objects.find((o) => o.id === 'r')!.behaviors).toEqual(p.objects.find((o) => o.id === 'r')!.behaviors);
  });

  it('round-trip inside a multi-scene doc (interactions stay project-level, behaviors per-scene-object)', () => {
    const doc2: ShortDoc = {
      meta: {},
      scenes: [
        { duration: 1, objects: [{ type: 'rect', id: 'r', x: 0, y: 0, width: 10, height: 10, behaviors: [{ id: 'b1', event: 'click', actions: [] }] }] },
      ],
      interactions: { variables: [{ name: 'v', initial: true }] },
    };
    const p = compileShort(doc2);
    const recompiled = compileShort(decompileProject(p));
    expect(recompiled.interactions).toEqual(p.interactions);
    expect(recompiled.scenes![0].objects[0].behaviors).toEqual(p.scenes![0].objects[0].behaviors);
  });
});
