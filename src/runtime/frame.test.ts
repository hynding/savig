import { describe, expect, it } from 'vitest';
import {
  buildTransform,
  createKeyframe,
  createProject,
  createGroupObject,
  createSceneObject,
  createVectorAsset,
  fmt,
  geometryToSvgAttrs,
  gradientToSvg,
  interpolate,
  pathToD,
  resolveAnchor,
  samplePath,
  sampleProject,
  type Project,
  type ShapeKeyframe,
} from '../engine';
import { applyFrameToNodes, computeFrame } from './frame';
import { sampleColor } from '../engine/color';
import { sampleGradient } from '../engine/gradientAnim';

function animated(): Project {
  const project = createProject();
  project.assets.push({
    id: 'aaaa1111', kind: 'svg', name: 'x', normalizedContent: '<svg/>', viewBox: '0 0 1 1', width: 1, height: 1,
  });
  const obj = createSceneObject('aaaa1111', { id: 'o1', anchorX: 5, anchorY: 5 });
  obj.tracks.x = [createKeyframe(0, 0), createKeyframe(1, 100)];
  project.objects.push(obj);
  return project;
}

describe('computeFrame parity with engine sampling', () => {
  it('matches sampleProject + buildTransform at multiple times', () => {
    const project = animated();
    for (const t of [0, 0.25, 0.5, 1]) {
      const expected = sampleProject(project, t).map((state) => {
        const obj = project.objects.find((o) => o.id === state.objectId)!;
        return {
          objectId: state.objectId,
          transform: buildTransform(state, obj.anchorX, obj.anchorY),
          opacity: fmt(state.opacity),
        };
      });
      expect(computeFrame(project, t)).toEqual(expected);
    }
  });
});

function animatedVector(): Project {
  const project = createProject();
  project.assets.push(createVectorAsset('rect', { id: 'vrect1' }));
  const obj = createSceneObject('vrect1', {
    id: 'v1',
    anchorMode: 'fraction',
    anchorX: 0.5,
    anchorY: 0.5,
    shapeBase: { width: 100, height: 50 },
  });
  obj.tracks.width = [createKeyframe(0, 100), createKeyframe(1, 200)];
  project.objects.push(obj);
  return project;
}

describe('computeFrame parity for vector geometry', () => {
  it('matches engine geometry attrs + resolved fractional anchor at multiple times', () => {
    const project = animatedVector();
    const obj = project.objects[0];
    for (const t of [0, 0.5, 1]) {
      const [state] = sampleProject(project, t);
      const { anchorX, anchorY } = resolveAnchor(obj, state, 'rect');
      const expected = [
        {
          objectId: 'v1',
          transform: buildTransform(state, anchorX, anchorY),
          opacity: fmt(state.opacity),
          geometry: geometryToSvgAttrs('rect', state.geometry!),
        },
      ];
      expect(computeFrame(project, t)).toEqual(expected);
    }
  });

  it('emits no geometry for imported SVG objects', () => {
    const project = animated();
    expect(computeFrame(project, 0)[0].geometry).toBeUndefined();
  });
});

describe('computeFrame for path objects', () => {
  it('produces no geometry for a path object and pivots on its bbox', () => {
    const path = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }], closed: false };
    const asset = createVectorAsset('path', { id: 'vpath1', path });
    const obj = createSceneObject('vpath1', {
      id: 'po1',
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 90, opacity: 1 },
    });
    const project: Project = { ...createProject(), assets: [asset], objects: [obj] };

    const items = computeFrame(project, 0);
    const item = items.find((i) => i.objectId === 'po1')!;
    expect(item.geometry).toBeUndefined();
    // bbox center is (10, 0): the rotate pivot must be there, matching the export.
    expect(item.transform).toContain('rotate(90, 10, 0)');
  });
});

describe('computeFrame path morphing', () => {
  const k0 = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 0, y: 0 } }] };
  const k2 = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }] };
  const shapeTrack: ShapeKeyframe[] = [
    { time: 0, easing: 'linear', path: k0 },
    { time: 2, easing: 'linear', path: k2 },
  ];

  function morphProject(): Project {
    const asset = createVectorAsset('path', { path: k0 });
    const obj = createSceneObject(asset.id, { anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5, shapeTrack });
    return { ...createProject(), assets: [asset], objects: [obj] };
  }

  it('emits pathD equal to pathToD(sampled path) for morphed paths', () => {
    const item = computeFrame(morphProject(), 1)[0];
    expect(item.pathD).toBe(pathToD(samplePath(shapeTrack, 1)));
  });

  it('does NOT emit pathD for a static (no shapeTrack) path', () => {
    const asset = createVectorAsset('path', { path: k0 });
    const obj = createSceneObject(asset.id, { anchorMode: 'fraction' });
    const project = { ...createProject(), assets: [asset], objects: [obj] };
    expect(computeFrame(project, 1)[0].pathD).toBeUndefined();
  });

  it('emits pathD equal to pathToD(samplePath) for a RESAMPLED morph', () => {
    const ra = { closed: true, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 10 } }] };
    const rb = { closed: true, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }] };
    const rTrack: ShapeKeyframe[] = [
      { time: 0, easing: 'linear', path: ra, morph: 'resampled' },
      { time: 2, easing: 'linear', path: rb },
    ];
    const asset = createVectorAsset('path', { path: ra });
    const obj = createSceneObject(asset.id, { anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5, shapeTrack: rTrack });
    const project = { ...createProject(), assets: [asset], objects: [obj] };
    const item = computeFrame(project, 1)[0];
    // Stage/runtime parity: computeFrame routes through the same samplePath -> pathToD.
    expect(item.pathD).toBe(pathToD(samplePath(rTrack, 1)));
    expect(samplePath(rTrack, 1).nodes.length).toBe(64); // actually resampled, not index-pad
  });

  it('emits pathD equal to pathToD(samplePath) for a CORRESPONDENCE-mapped morph at several t', () => {
    const ca = { closed: true, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 5, y: 10 } }] };
    const cb = { closed: true, nodes: [{ anchor: { x: 5, y: 10 } }, { anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }] };
    const cTrack: ShapeKeyframe[] = [
      { time: 0, easing: 'linear', morph: 'corresponded', correspondence: [1, 2, 0], path: ca },
      { time: 2, easing: 'linear', path: cb },
    ];
    const asset = createVectorAsset('path', { path: ca });
    const obj = createSceneObject(asset.id, { anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5, shapeTrack: cTrack });
    const project = { ...createProject(), assets: [asset], objects: [obj] };
    // Interior fractions across the 0..2 morph interval, plus the boundary/clamped cases.
    for (const t of [0, 0.25, 0.5, 1, 1.5, 1.75, 2]) {
      expect(computeFrame(project, t)[0].pathD).toBe(pathToD(samplePath(cTrack, t)));
    }
  });

  it('emits pathD equal to pathToD(samplePath) for a PER-NODE-EASED morph at several t', () => {
    const na = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 0, y: 0 } }] };
    const nb = { closed: false, nodes: [{ anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 0 } }] };
    const nTrack: ShapeKeyframe[] = [
      { time: 0, easing: 'linear', nodeEasings: ['easeIn', 'easeOut'], path: na },
      { time: 2, easing: 'linear', path: nb },
    ];
    const asset = createVectorAsset('path', { path: na });
    const obj = createSceneObject(asset.id, { anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5, shapeTrack: nTrack });
    const project = { ...createProject(), assets: [asset], objects: [obj] };
    for (const t of [0, 0.5, 1, 1.5, 2]) {
      expect(computeFrame(project, t)[0].pathD).toBe(pathToD(samplePath(nTrack, t)));
    }
  });
});

describe('applyFrameToNodes path d', () => {
  it('sets the inner shape `d` when pathD is present', () => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-savig-object', 'obj-1');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    g.appendChild(path);
    const nodes = new Map<string, Element>([['obj-1', g]]);
    applyFrameToNodes(nodes, [
      { objectId: 'obj-1', transform: '', opacity: '1', pathD: 'M 0 0 L 5 0' },
    ]);
    expect(path.getAttribute('d')).toBe('M 0 0 L 5 0');
  });
});

describe('computeFrame color animation', () => {
  it('emits fill AND stroke equal to sampleColor at several t', () => {
    const fill = [
      { time: 0, value: '#000000', easing: 'linear' as const },
      { time: 2, value: '#ffffff', easing: 'linear' as const },
    ];
    const stroke = [
      { time: 0, value: '#ff0000', easing: 'linear' as const },
      { time: 2, value: '#0000ff', easing: 'linear' as const },
    ];
    const asset = createVectorAsset('rect', {});
    const obj = createSceneObject(asset.id, { shapeBase: { width: 10, height: 10 }, colorTracks: { fill, stroke } });
    const project = { ...createProject(), assets: [asset], objects: [obj] };
    for (const t of [0, 0.5, 1, 1.5, 2]) {
      expect(computeFrame(project, t)[0].fill).toBe(sampleColor(fill, t));
      expect(computeFrame(project, t)[0].stroke).toBe(sampleColor(stroke, t));
    }
  });

  it('does NOT emit fill/stroke for an object with no color track', () => {
    const asset = createVectorAsset('rect', {});
    const obj = createSceneObject(asset.id, { shapeBase: { width: 10, height: 10 } });
    const project = { ...createProject(), assets: [asset], objects: [obj] };
    expect(computeFrame(project, 1)[0].fill).toBeUndefined();
  });

  it('omits fill when the object has a fill gradient, even with a fill color track', () => {
    const grad = {
      type: 'linear' as const,
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 0,
      stops: [
        { offset: 0, color: '#000000' },
        { offset: 1, color: '#ffffff' },
      ],
    };
    const fill = [
      { time: 0, value: '#abcdef', easing: 'linear' as const },
      { time: 1, value: '#123456', easing: 'linear' as const },
    ];
    const asset = createVectorAsset('rect', {
      style: { fill: '#abcdef', stroke: 'none', strokeWidth: 0, fillGradient: grad },
    });
    const obj = createSceneObject(asset.id, {
      shapeBase: { width: 10, height: 10 },
      colorTracks: { fill },
    });
    const project = { ...createProject(), assets: [asset], objects: [obj] };
    expect(computeFrame(project, 0.5)[0].fill).toBeUndefined();
  });

  it('applyFrameToNodes sets fill/stroke on the inner shape element', () => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-savig-object', 'obj-1');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    g.appendChild(rect);
    const nodes = new Map<string, Element>([['obj-1', g]]);
    applyFrameToNodes(nodes, [{ objectId: 'obj-1', transform: '', opacity: '1', fill: '#808080' }]);
    expect(rect.getAttribute('fill')).toBe('#808080');
  });
});

describe('computeFrame animated gradients', () => {
  const g0 = {
    type: 'linear' as const,
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 0,
    stops: [
      { offset: 0, color: '#000000' },
      { offset: 1, color: '#000000' },
    ],
  };
  const g1 = {
    type: 'linear' as const,
    x1: 0,
    y1: 0,
    x2: 1,
    y2: 0,
    stops: [
      { offset: 0, color: '#ffffff' },
      { offset: 1, color: '#ffffff' },
    ],
  };

  function gradientTrackProject(): Project {
    const asset = createVectorAsset('rect', { id: 'grad-asset' });
    const obj = createSceneObject('grad-asset', {
      id: 'o1',
      shapeBase: { width: 10, height: 10 },
      // A fill color track that the gradient track must suppress.
      colorTracks: {
        fill: [
          { time: 0, value: '#abcdef', easing: 'linear' },
          { time: 2, value: '#123456', easing: 'linear' },
        ],
      },
      gradientTracks: {
        fill: [
          { time: 0, gradient: g0, easing: 'linear' },
          { time: 2, gradient: g1, easing: 'linear' },
        ],
      },
    });
    return { ...createProject(), assets: [asset], objects: [obj] };
  }

  it('carries the sampled gradient on the FrameItem and suppresses a color track', () => {
    const item = computeFrame(gradientTrackProject(), 1).find((i) => i.objectId === 'o1')!;
    expect(item.fillGradient).toBeDefined();
    expect(item.fillGradient).toEqual(sampleGradient(gradientTrackProject().objects[0].gradientTracks!.fill!, 1));
    expect(item.fill).toBeUndefined(); // gradient beats the color track
  });
});

describe('applyFrameToNodes gradient def parity', () => {
  it('live runtime def matches gradientToSvg(sampleGradient(track, t)) structurally', () => {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const g0 = {
      type: 'linear' as const,
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 0,
      stops: [
        { offset: 0, color: '#000000' },
        { offset: 1, color: '#000000' },
      ],
    };
    const g1 = {
      type: 'linear' as const,
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 0,
      stops: [
        { offset: 0, color: '#ffffff' },
        { offset: 1, color: '#ffffff' },
      ],
    };
    const track = [
      { time: 0, gradient: g0, easing: 'linear' as const },
      { time: 2, gradient: g1, easing: 'linear' as const },
    ];
    const asset = createVectorAsset('rect', { id: 'pa' });
    const obj = createSceneObject('pa', {
      id: 'o1',
      shapeBase: { width: 10, height: 10 },
      gradientTracks: { fill: track },
    });
    const project: Project = { ...createProject(), assets: [asset], objects: [obj] };

    // Build an export-shaped tree: <svg><defs><linearGradient@0/></defs><g><rect/></g></svg>
    const svg = document.createElementNS(SVG_NS, 'svg');
    const defs = document.createElementNS(SVG_NS, 'defs');
    const liveDef = document.createElementNS(SVG_NS, 'linearGradient');
    liveDef.setAttribute('id', 'savig-grad-o1-fill');
    defs.appendChild(liveDef);
    svg.appendChild(defs);
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('data-savig-object', 'o1');
    g.appendChild(document.createElementNS(SVG_NS, 'rect'));
    svg.appendChild(g);
    document.body.appendChild(svg);

    const t = 1;
    applyFrameToNodes(new Map<string, Element>([['o1', g]]), computeFrame(project, t));

    const oracleDef = new DOMParser()
      .parseFromString(
        `<svg xmlns="${SVG_NS}"><defs>${gradientToSvg('savig-grad-o1-fill', sampleGradient(track, t))}</defs></svg>`,
        'image/svg+xml',
      )
      .querySelector('#savig-grad-o1-fill')!;
    const attrsOf = (el: Element) => Object.fromEntries(Array.from(el.attributes).map((a) => [a.name, a.value]));
    const stopsOf = (el: Element) => Array.from(el.querySelectorAll('stop')).map(attrsOf);
    expect(liveDef.tagName.toLowerCase()).toBe(oracleDef.tagName.toLowerCase());
    expect(attrsOf(liveDef)).toEqual(attrsOf(oracleDef));
    expect(stopsOf(liveDef)).toEqual(stopsOf(oracleDef));
    svg.remove();
  });
});

describe('applyFrameToNodes gradient def', () => {
  it('updates the gradient element coords + stops by id', () => {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVG_NS, 'svg');
    const defs = document.createElementNS(SVG_NS, 'defs');
    const def = document.createElementNS(SVG_NS, 'linearGradient');
    def.setAttribute('id', 'savig-grad-o1-fill');
    def.setAttribute('x2', '0');
    def.appendChild(document.createElementNS(SVG_NS, 'stop')); // a single stale stop
    defs.appendChild(def);
    svg.appendChild(defs);
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('data-savig-object', 'o1');
    g.appendChild(document.createElementNS(SVG_NS, 'rect'));
    svg.appendChild(g);
    document.body.appendChild(svg);

    const grad = {
      type: 'linear' as const,
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 0,
      stops: [
        { offset: 0, color: '#112233' },
        { offset: 1, color: '#445566' },
      ],
    };
    const nodes = new Map<string, Element>([['o1', g]]);
    applyFrameToNodes(nodes, [
      { objectId: 'o1', transform: 'translate(0,0)', opacity: '1', fillGradient: grad },
    ]);
    expect(def.getAttribute('x2')).toBe('1');
    expect(def.querySelectorAll('stop').length).toBe(2);
    expect(def.querySelector('stop')!.getAttribute('stop-color')).toBe('#112233');
    svg.remove();
  });
});

describe('computeFrame dash offset', () => {
  it('emits strokeDashoffset = fmt(interpolate(track, t))', () => {
    const track = [
      { time: 0, value: 1, easing: 'linear' as const },
      { time: 2, value: 0, easing: 'linear' as const },
    ];
    const asset = createVectorAsset('rect', {});
    const obj = createSceneObject(asset.id, { shapeBase: { width: 10, height: 10 }, dashOffsetTrack: track });
    const project = { ...createProject(), assets: [asset], objects: [obj] };
    expect(computeFrame(project, 1)[0].strokeDashoffset).toBe(fmt(0.5));
  });

  it('does NOT emit strokeDashoffset without a track', () => {
    const asset = createVectorAsset('rect', {});
    const obj = createSceneObject(asset.id, { shapeBase: { width: 10, height: 10 } });
    const project = { ...createProject(), assets: [asset], objects: [obj] };
    expect(computeFrame(project, 1)[0].strokeDashoffset).toBeUndefined();
  });
});

describe('applyFrameToNodes dash offset', () => {
  it('sets stroke-dashoffset on the inner shape', () => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-savig-object', 'obj-1');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    g.appendChild(rect);
    const nodes = new Map<string, Element>([['obj-1', g]]);
    applyFrameToNodes(nodes, [{ objectId: 'obj-1', transform: '', opacity: '1', strokeDashoffset: '0.5' }]);
    expect(rect.getAttribute('stroke-dashoffset')).toBe('0.5');
  });
});

describe('dash offset parity', () => {
  it('runtime applies stroke-dashoffset == fmt(interpolate(track, t))', () => {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const track = [
      { time: 0, value: 1, easing: 'linear' as const },
      { time: 2, value: 0, easing: 'linear' as const },
    ];
    const asset = createVectorAsset('rect', {
      style: { fill: 'none', stroke: '#000', strokeWidth: 1, strokeDasharray: [1, 1] },
    });
    const obj = createSceneObject(asset.id, {
      id: 'o1',
      shapeBase: { width: 10, height: 10 },
      dashOffsetTrack: track,
    });
    const project: Project = { ...createProject(), assets: [asset], objects: [obj] };
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('data-savig-object', 'o1');
    g.appendChild(document.createElementNS(SVG_NS, 'rect'));
    const t = 1;
    applyFrameToNodes(new Map<string, Element>([['o1', g]]), computeFrame(project, t));
    expect(g.firstElementChild!.getAttribute('stroke-dashoffset')).toBe(fmt(interpolate(track, t)));
  });
});

describe('computeFrame motion path', () => {
  it('transform equals a static object placed at the followed point (parity)', () => {
    const guide = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }], closed: false };
    const progress = [
      { time: 0, value: 0, easing: 'linear' as const },
      { time: 2, value: 1, easing: 'linear' as const },
    ];
    const follower = createSceneObject('a', {
      id: 'follower',
      motionPath: { path: guide, orient: false, progress },
    });
    // at t=1 the follower is at x=50 -> same transform as a static object at base.x=50
    const staticAt50 = createSceneObject('a', {
      id: 'static',
      base: { x: 50, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    });
    const fFrame = computeFrame({ ...createProject(), objects: [follower] }, 1)[0];
    const sFrame = computeFrame({ ...createProject(), objects: [staticAt50] }, 1)[0];
    expect(fFrame.transform).toBe(sFrame.transform);
  });
});

describe('group containers (slice 45)', () => {
  it('skips a group object and prepends the group transform to its child', () => {
    const project = createProject();
    project.assets.push({
      id: 'asset1', kind: 'svg', name: 'x', normalizedContent: '<svg/>', viewBox: '0 0 1 1', width: 1, height: 1,
    });
    const g = createGroupObject({ id: 'g1', anchorX: 0, anchorY: 0, zOrder: 0 });
    g.base = { ...g.base, x: 10, y: 20 };
    const child = createSceneObject('asset1', { id: 'c1', parentId: 'g1', base: { x: 5, y: 7, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    project.objects.push(g, child);
    const frame = computeFrame(project, 0);
    expect(frame.find((f) => f.objectId === 'g1')).toBeUndefined(); // group has no FrameItem
    const c = frame.find((f) => f.objectId === 'c1')!;
    expect(c.transform.startsWith('translate(10, 20)')).toBe(true); // group prefix first
    expect(c.transform).toContain('translate(5, 7)'); // then the child's own transform
  });
});

describe('animated group composes per frame (slice 45d)', () => {
  it('a group with an x track animates its child transform over time', () => {
    const project = createProject();
    project.assets.push({ id: 'asset1', kind: 'svg', name: 'x', normalizedContent: '<svg/>', viewBox: '0 0 1 1', width: 1, height: 1 });
    const g = createGroupObject({ id: 'g1', anchorX: 0, anchorY: 0, zOrder: 0 });
    g.tracks.x = [createKeyframe(0, 0), createKeyframe(1, 100)]; // animate the group
    const child = createSceneObject('asset1', { id: 'c1', parentId: 'g1', base: { x: 5, y: 7, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    project.objects.push(g, child);
    const at0 = computeFrame(project, 0).find((f) => f.objectId === 'c1')!;
    const at1 = computeFrame(project, 1).find((f) => f.objectId === 'c1')!;
    expect(at0.transform.startsWith('translate(0, 0)')).toBe(true); // group prefix @ t0
    expect(at1.transform.startsWith('translate(100, 0)')).toBe(true); // group prefix @ t1 (animated)
    expect(at0.transform).not.toBe(at1.transform); // the child moves with the group
  });
});

describe('nested groups compose per frame (slice 45e)', () => {
  it('a child in an inner group in an outer group gets both prefixes', () => {
    const project = createProject();
    project.assets.push({ id: 'asset1', kind: 'svg', name: 'x', normalizedContent: '<svg/>', viewBox: '0 0 1 1', width: 1, height: 1 });
    const gp = createGroupObject({ id: 'gp', anchorX: 0, anchorY: 0, zOrder: 2 });
    gp.base = { ...gp.base, x: 100, y: 0 };
    const p = createGroupObject({ id: 'p', anchorX: 0, anchorY: 0, zOrder: 1 });
    p.base = { ...p.base, x: 10, y: 0 };
    p.parentId = 'gp';
    const child = createSceneObject('asset1', { id: 'c1', parentId: 'p', base: { x: 5, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    project.objects.push(gp, p, child);
    const c = computeFrame(project, 0).find((f) => f.objectId === 'c1')!;
    expect(c.transform.startsWith('translate(100, 0)')).toBe(true); // outer first
    expect(c.transform).toContain('translate(10, 0)'); // then inner
    expect(c.transform).toContain('translate(5, 0)'); // then the child
    expect(computeFrame(project, 0).find((f) => f.objectId === 'gp')).toBeUndefined(); // groups have no item
    expect(computeFrame(project, 0).find((f) => f.objectId === 'p')).toBeUndefined();
  });
});
