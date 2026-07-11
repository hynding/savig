import { describe, expect, it } from 'vitest';
import { computeBlendSteps } from './blend';
import { createKeyframe, createProject, createSceneObject, createVectorAsset } from './project';
import { interpolateColor } from './color';
import { interpolateGradient } from './gradientAnim';
import { SAMPLE_COUNT } from './morph/resample';
import type { Gradient, PathData, Project, SceneObject, VectorAsset } from './types';

// Build a project from a list of [object, asset] pairs (boolean.test.ts / textPath.test.ts precedent).
function proj(...pairs: [SceneObject, VectorAsset][]): Project {
  return { ...createProject(), objects: pairs.map((p) => p[0]), assets: pairs.map((p) => p[1]) };
}

// A plain path object+asset pair, identity transform unless overridden.
function pathObjAsset(
  id: string,
  path: PathData,
  objOverrides: Partial<SceneObject> = {},
  assetOverrides: Partial<VectorAsset> = {},
): [SceneObject, VectorAsset] {
  const assetId = `${id}-asset`;
  const asset = createVectorAsset('path', { id: assetId, path, ...assetOverrides });
  const obj = createSceneObject(assetId, {
    id,
    anchorX: 0,
    anchorY: 0,
    base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    ...objOverrides,
  });
  return [obj, asset];
}

describe('computeBlendSteps — world-space bake (hand-computed)', () => {
  // A: local path (0,0)-(10,0), translated (10,20) + rotated 90deg (mapPoint reduces to
  // world = (t.x - py, t.y + px) for a point (px,py) measured from the anchor at 90deg).
  // Hand-computed: node0 (0,0) -> world (10,20). node1 (10,0) -> world (10,30).
  // B: local path (0,0)-(0,10), identity transform -> world equals local: (0,0),(0,10).
  it('bakes each source through its full transform before interpolating (translate+rotate vs identity)', () => {
    const [a, assetA] = pathObjAsset(
      'a',
      { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }] },
      { base: { x: 10, y: 20, scaleX: 1, scaleY: 1, rotation: 90, opacity: 1 } },
    );
    const [b, assetB] = pathObjAsset('b', {
      closed: false,
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 0, y: 10 } }],
    });
    const steps = computeBlendSteps(proj([a, assetA], [b, assetB]), a, b, { count: 1 });
    expect(steps).not.toBeNull();
    expect(steps).toHaveLength(1);
    const [{ path }] = steps!;
    expect(path.closed).toBe(false);
    expect(path.nodes).toHaveLength(2);
    // t = applyEasing('linear', 1/2) = 0.5; midpoint of world A ((10,20),(10,30)) and world B
    // ((0,0),(0,10)): node0 = (5,10), node1 = (5,20).
    expect(path.nodes[0].anchor.x).toBeCloseTo(5, 9);
    expect(path.nodes[0].anchor.y).toBeCloseTo(10, 9);
    expect(path.nodes[1].anchor.x).toBeCloseTo(5, 9);
    expect(path.nodes[1].anchor.y).toBeCloseTo(20, 9);
  });
});

describe('computeBlendSteps — handle lerp preserved (equal node count)', () => {
  it('lerps in/out handle OFFSETS the same way lerpNode does, not just anchors', () => {
    const [a, assetA] = pathObjAsset('a', {
      closed: false,
      nodes: [
        { anchor: { x: 0, y: 0 }, out: { x: 10, y: 0 } },
        { anchor: { x: 20, y: 0 }, in: { x: -5, y: 0 } },
      ],
    });
    const [b, assetB] = pathObjAsset('b', {
      closed: false,
      nodes: [
        { anchor: { x: 100, y: 100 }, out: { x: 5, y: 5 } },
        { anchor: { x: 200, y: 100 }, in: { x: -5, y: -5 } },
      ],
    });
    const steps = computeBlendSteps(proj([a, assetA], [b, assetB]), a, b, { count: 1 });
    expect(steps).not.toBeNull();
    const [{ path }] = steps!;
    // t = 0.5 (identity transforms -> world === local, so this is a plain lerpNode check).
    expect(path.nodes[0].anchor).toEqual({ x: 50, y: 50 });
    expect(path.nodes[0].out).toEqual({ x: 7.5, y: 2.5 });
    expect(path.nodes[1].anchor).toEqual({ x: 110, y: 50 });
    expect(path.nodes[1].in).toEqual({ x: -5, y: -2.5 });
  });
});

describe('computeBlendSteps — unequal node counts resample to SAMPLE_COUNT (64)', () => {
  it('every intermediate has 64 nodes when A and B have different counts', () => {
    const [a, assetA] = pathObjAsset('a', {
      closed: true,
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 5, y: 10 } }],
    });
    const [b, assetB] = pathObjAsset('b', {
      closed: true,
      nodes: [
        { anchor: { x: 0, y: 0 } },
        { anchor: { x: 10, y: 0 } },
        { anchor: { x: 10, y: 10 } },
        { anchor: { x: 0, y: 10 } },
      ],
    });
    const steps = computeBlendSteps(proj([a, assetA], [b, assetB]), a, b, { count: 2 });
    expect(steps).not.toBeNull();
    expect(steps).toHaveLength(2);
    for (const step of steps!) {
      expect(step.path.nodes).toHaveLength(SAMPLE_COUNT);
      expect(SAMPLE_COUNT).toBe(64);
    }
  });
});

describe('computeBlendSteps — easing shifts t', () => {
  const nodesA: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }] };
  const nodesB: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 100 } }, { anchor: { x: 10, y: 100 } }] };

  it('easeIn(0.5) = 0.25 midpoint differs from the linear(0.5) = 0.5 midpoint', () => {
    const [a, assetA] = pathObjAsset('a', nodesA);
    const [b, assetB] = pathObjAsset('b', nodesB);
    const project = proj([a, assetA], [b, assetB]);

    const linearSteps = computeBlendSteps(project, a, b, { count: 1, easing: 'linear' });
    const easeInSteps = computeBlendSteps(project, a, b, { count: 1, easing: 'easeIn' });
    expect(linearSteps![0].path.nodes[0].anchor.y).toBeCloseTo(50, 9);
    expect(easeInSteps![0].path.nodes[0].anchor.y).toBeCloseTo(25, 9);
    expect(easeInSteps![0].path.nodes[0].anchor.y).not.toBeCloseTo(linearSteps![0].path.nodes[0].anchor.y, 9);
  });
});

describe('computeBlendSteps — style rules', () => {
  const nodes: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }] };

  it('solid<->solid fill uses interpolateColor; strokeWidth/opacity numeric-lerp', () => {
    const [a, assetA] = pathObjAsset(
      'a',
      nodes,
      { base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } },
      { style: { fill: '#ff0000', stroke: 'none', strokeWidth: 2 } },
    );
    const [b, assetB] = pathObjAsset(
      'b',
      nodes,
      { base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.2 } },
      { style: { fill: '#0000ff', stroke: 'none', strokeWidth: 10 } },
    );
    const steps = computeBlendSteps(proj([a, assetA], [b, assetB]), a, b, { count: 1 });
    expect(steps).not.toBeNull();
    const [{ style, opacity }] = steps!;
    expect(style.fill).toBe(interpolateColor('#ff0000', '#0000ff', 0.5));
    expect(style.strokeWidth).toBeCloseTo(6, 9); // 2 + (10-2)*0.5
    expect(opacity).toBeCloseTo(0.6, 9); // 1 + (0.2-1)*0.5
    expect(style.fillGradient).toBeUndefined();
    // Dash fields are never copied onto a fresh blend style; absent on both A and B,
    // strokeLinecap/strokeLinejoin (held from A) stay absent too.
    expect(style.strokeDasharray).toBeUndefined();
    expect(style.strokeLinecap).toBeUndefined();
    expect(style.strokeLinejoin).toBeUndefined();
  });

  it('strokeLinecap/strokeLinejoin are HELD FROM A (I1 fix) — B\'s values never leak, absent-on-A stays absent', () => {
    const [a, assetA] = pathObjAsset(
      'a',
      nodes,
      {},
      { style: { fill: '#ff0000', stroke: '#000000', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } },
    );
    const [b, assetB] = pathObjAsset(
      'b',
      nodes,
      {},
      { style: { fill: '#0000ff', stroke: '#000000', strokeWidth: 10, strokeLinecap: 'butt', strokeLinejoin: 'miter' } },
    );
    const steps = computeBlendSteps(proj([a, assetA], [b, assetB]), a, b, { count: 1 });
    expect(steps).not.toBeNull();
    // Held from A regardless of t/B's differing values — no lerp/step rule for cosmetic caps.
    expect(steps![0].style.strokeLinecap).toBe('round');
    expect(steps![0].style.strokeLinejoin).toBe('round');

    // A has no explicit linecap/linejoin -> absent stays absent even though B has one.
    const [a2, assetA2] = pathObjAsset('a2', nodes, {}, { style: { fill: '#ff0000', stroke: 'none', strokeWidth: 2 } });
    const [b2, assetB2] = pathObjAsset(
      'b2',
      nodes,
      {},
      { style: { fill: '#0000ff', stroke: 'none', strokeWidth: 10, strokeLinecap: 'square', strokeLinejoin: 'bevel' } },
    );
    const steps2 = computeBlendSteps(proj([a2, assetA2], [b2, assetB2]), a2, b2, { count: 1 });
    expect(steps2).not.toBeNull();
    expect(steps2![0].style.strokeLinecap).toBeUndefined();
    expect(steps2![0].style.strokeLinejoin).toBeUndefined();
  });

  it('gradient<->gradient fill uses interpolateGradient', () => {
    const gradA: Gradient = {
      type: 'linear',
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 0,
      stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
    };
    const gradB: Gradient = {
      type: 'linear',
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 1,
      stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#000000' }],
    };
    const [a, assetA] = pathObjAsset('a', nodes, {}, { style: { fill: '#111111', stroke: 'none', strokeWidth: 0, fillGradient: gradA } });
    const [b, assetB] = pathObjAsset('b', nodes, {}, { style: { fill: '#222222', stroke: 'none', strokeWidth: 0, fillGradient: gradB } });
    const steps = computeBlendSteps(proj([a, assetA], [b, assetB]), a, b, { count: 1 });
    const [{ style }] = steps!;
    expect(style.fillGradient).toEqual(interpolateGradient(gradA, gradB, 0.5));
    // t (0.5) < 1 -> the inert solid fallback holds A's raw fill value.
    expect(style.fill).toBe('#111111');
  });

  it('a kind mismatch (solid<->gradient) STEPS holding A for every generated intermediate (t is always < 1)', () => {
    const gradA: Gradient = {
      type: 'linear',
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 0,
      stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
    };
    const [a, assetA] = pathObjAsset('a', nodes, {}, { style: { fill: '#123456', stroke: 'none', strokeWidth: 0, fillGradient: gradA } });
    const [b, assetB] = pathObjAsset('b', nodes, {}, { style: { fill: '#abcdef', stroke: 'none', strokeWidth: 0 } });
    const project = proj([a, assetA], [b, assetB]);
    const steps = computeBlendSteps(project, a, b, { count: 3 });
    expect(steps).not.toBeNull();
    for (const step of steps!) {
      expect(step.style.fill).toBe('#123456');
      expect(step.style.fillGradient).toEqual(gradA);
    }
  });

  it('an unparseable/none <-> paint mismatch STEPS holding A (stroke: none vs a solid color)', () => {
    const [a, assetA] = pathObjAsset('a', nodes, {}, { style: { fill: '#cccccc', stroke: 'none', strokeWidth: 1 } });
    const [b, assetB] = pathObjAsset('b', nodes, {}, { style: { fill: '#cccccc', stroke: '#ff00ff', strokeWidth: 1 } });
    const steps = computeBlendSteps(proj([a, assetA], [b, assetB]), a, b, { count: 1 });
    expect(steps![0].style.stroke).toBe('none');
  });
});

describe('computeBlendSteps — closed held from A', () => {
  it('result.closed follows A even when B differs (equal-count corresponded case)', () => {
    const triA: PathData = {
      closed: true,
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 5, y: 10 } }],
    };
    const triB: PathData = {
      closed: false,
      nodes: [{ anchor: { x: 0, y: 20 } }, { anchor: { x: 10, y: 20 } }, { anchor: { x: 5, y: 30 } }],
    };
    const [a, assetA] = pathObjAsset('a', triA);
    const [b, assetB] = pathObjAsset('b', triB);
    const closedTrue = computeBlendSteps(proj([a, assetA], [b, assetB]), a, b, { count: 1 });
    expect(closedTrue![0].path.closed).toBe(true);

    const [a2, assetA2] = pathObjAsset('a2', triB); // A now the OPEN one
    const [b2, assetB2] = pathObjAsset('b2', triA);
    const closedFalse = computeBlendSteps(proj([a2, assetA2], [b2, assetB2]), a2, b2, { count: 1 });
    expect(closedFalse![0].path.closed).toBe(false);
  });
});

describe('computeBlendSteps — bakes an animated (tracked) source at opts.time', () => {
  it('a transform-animated A produces different intermediates at different times', () => {
    const [a, assetA] = pathObjAsset('a', {
      closed: false,
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
    });
    a.tracks = { x: [createKeyframe(0, 0), createKeyframe(1, 100)] };
    const [b, assetB] = pathObjAsset('b', {
      closed: false,
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
    });
    const project = proj([a, assetA], [b, assetB]);

    const at0 = computeBlendSteps(project, a, b, { count: 1, time: 0 });
    const at1 = computeBlendSteps(project, a, b, { count: 1, time: 1 });
    expect(at0).not.toBeNull();
    expect(at1).not.toBeNull();
    // time=0: track resolves x=0 -> A world === B world -> midpoint === both, unchanged shape.
    expect(at0![0].path.nodes[0].anchor).toEqual({ x: 0, y: 0 });
    expect(at0![0].path.nodes[1].anchor).toEqual({ x: 10, y: 0 });
    // time=1: track resolves x=100 -> A world = (100,0)-(110,0); midpoint with B (0,0)-(10,0):
    // node0 = (50,0), node1 = (60,0).
    expect(at1![0].path.nodes[0].anchor.x).toBeCloseTo(50, 9);
    expect(at1![0].path.nodes[1].anchor.x).toBeCloseTo(60, 9);
    expect(at1).not.toEqual(at0);
  });
});

describe('computeBlendSteps — null gates', () => {
  const nodes: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }] };

  function validB(): [SceneObject, VectorAsset] {
    return pathObjAsset('b', nodes);
  }

  it('null when count < 1', () => {
    const [a, assetA] = pathObjAsset('a', nodes);
    const [b, assetB] = validB();
    expect(computeBlendSteps(proj([a, assetA], [b, assetB]), a, b, { count: 0 })).toBeNull();
  });

  it('null when A is not a vector-path asset (rect)', () => {
    const asset = createVectorAsset('rect', { id: 'a-asset' });
    const a = createSceneObject('a-asset', { id: 'a' });
    const [b, assetB] = validB();
    expect(computeBlendSteps(proj([a, asset], [b, assetB]), a, b, { count: 1 })).toBeNull();
  });

  it('null when A has an empty path', () => {
    const [a, assetA] = pathObjAsset('a', { closed: false, nodes: [] });
    const [b, assetB] = validB();
    expect(computeBlendSteps(proj([a, assetA], [b, assetB]), a, b, { count: 1 })).toBeNull();
  });

  it('null when A has compoundRings', () => {
    const [a, assetA] = pathObjAsset('a', nodes, {}, { compoundRings: [nodes] });
    const [b, assetB] = validB();
    expect(computeBlendSteps(proj([a, assetA], [b, assetB]), a, b, { count: 1 })).toBeNull();
  });

  it('null when A is a live-boolean node', () => {
    const [a, assetA] = pathObjAsset('a', nodes, { boolean: { op: 'union', operandIds: ['x', 'y'] } });
    const [b, assetB] = validB();
    expect(computeBlendSteps(proj([a, assetA], [b, assetB]), a, b, { count: 1 })).toBeNull();
  });

  it('null when A has a shapeTrack (already morphing)', () => {
    const [a, assetA] = pathObjAsset('a', nodes, {
      shapeTrack: [{ time: 0, path: nodes, easing: 'linear' }],
    });
    const [b, assetB] = validB();
    expect(computeBlendSteps(proj([a, assetA], [b, assetB]), a, b, { count: 1 })).toBeNull();
  });
});
