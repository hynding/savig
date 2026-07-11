import { describe, expect, it } from 'vitest';
import { resolveTextPath } from './textPath';
import {
  createGroupObject,
  createKeyframe,
  createProject,
  createSceneObject,
  createVectorAsset,
} from './project';
import type { PathData, Project, SceneObject, VectorAsset } from './types';

// Build a project from a list of [object, asset] pairs (boolean.test.ts precedent).
function proj(...pairs: [SceneObject, VectorAsset][]): Project {
  return { ...createProject(), objects: pairs.map((p) => p[0]), assets: pairs.map((p) => p[1]) };
}

function textObjWith(overrides: Partial<SceneObject> = {}): SceneObject {
  // The text object itself never needs a real text asset for resolveTextPath — it only reads
  // `.textPath` and `.tracks.textPathOffset`. assetId is irrelevant here.
  return createSceneObject('unused-text-asset', { id: 'text1', ...overrides });
}

describe('resolveTextPath — parity / gating', () => {
  it('null when the text object has no textPath binding (callers unaffected)', () => {
    const target = createSceneObject('path-a', { id: 'p' });
    const asset = createVectorAsset('path', {
      id: 'path-a',
      path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }] },
    });
    const text = textObjWith(); // no .textPath
    expect(resolveTextPath(proj([target, asset]), text, 0)).toBeNull();
  });

  it('null for a dangling pathObjectId', () => {
    const text = textObjWith({ textPath: { pathObjectId: 'nope', startOffset: 0 } });
    expect(resolveTextPath(createProject(), text, 0)).toBeNull();
  });

  it('null when the target is not a vector path (rect target)', () => {
    const target = createSceneObject('rect-a', { id: 'p' });
    const asset = createVectorAsset('rect', { id: 'rect-a' });
    const text = textObjWith({ textPath: { pathObjectId: 'p', startOffset: 0 } });
    expect(resolveTextPath(proj([target, asset]), text, 0)).toBeNull();
  });

  it('null when the target is a live-boolean node (v1 fallback)', () => {
    const target = createSceneObject('path-a', {
      id: 'p',
      boolean: { op: 'union', operandIds: ['x', 'y'] },
    });
    const asset = createVectorAsset('path', {
      id: 'path-a',
      path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }] },
    });
    const text = textObjWith({ textPath: { pathObjectId: 'p', startOffset: 0 } });
    expect(resolveTextPath(proj([target, asset]), text, 0)).toBeNull();
  });
});

describe('resolveTextPath — bound basic (straight path, identity transform)', () => {
  it('worldD equals the input d when the target has an identity transform', () => {
    const path: PathData = {
      closed: false,
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 20, y: 5 } }],
    };
    const asset = createVectorAsset('path', { id: 'path-a', path });
    const target = createSceneObject('path-a', {
      id: 'p',
      anchorX: 0,
      anchorY: 0,
      base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    });
    const text = textObjWith({ textPath: { pathObjectId: 'p', startOffset: 0.5 } });
    const res = resolveTextPath(proj([target, asset]), text, 0);
    expect(res).not.toBeNull();
    expect(res!.worldD).toBe('M 0 0 L 10 0 L 20 5');
    expect(res!.startOffset).toBe(0.5);
  });
});

describe('resolveTextPath — transformed target (translate + rotate + scale)', () => {
  // Local path: node A anchor (0,0) with an OUT handle offset (10,0); node B anchor (20,0)
  // with an IN handle offset (-5,0) — a genuine cubic segment so handle transform is exercised.
  const path: PathData = {
    closed: false,
    nodes: [
      { anchor: { x: 0, y: 0 }, out: { x: 10, y: 0 } },
      { anchor: { x: 20, y: 0 }, in: { x: -5, y: 0 } },
    ],
  };

  // Target transform: translate (100,50), scaleX=2, scaleY=3, rotation=90deg, anchor at
  // (0,0) (absolute anchorMode — no bbox involved). mapPoint's rotation formula at 90deg
  // (c=0, s=1) reduces to: world = (t.x - scaleY*py, t.y + scaleX*px) for a point (px,py)
  // measured from the anchor. Hand-computed by hand (not by calling mapPoint) below.
  function transformedTarget(): [SceneObject, VectorAsset] {
    const asset = createVectorAsset('path', { id: 'path-a', path });
    const target = createSceneObject('path-a', {
      id: 'p',
      anchorX: 0,
      anchorY: 0,
      base: { x: 100, y: 50, scaleX: 2, scaleY: 3, rotation: 90, opacity: 1 },
    });
    return [target, asset];
  }

  it('anchors and handles map through translate+rotate+scale exactly (hand-computed)', () => {
    const [target, asset] = transformedTarget();
    const text = textObjWith({ textPath: { pathObjectId: 'p', startOffset: 0 } });
    const res = resolveTextPath(proj([target, asset]), text, 0);
    expect(res).not.toBeNull();
    // Node A anchor (0,0) -> ex=0,ey=0 -> world (100, 50).
    // Node A out-handle absolute (10,0) -> ex=20,ey=0 -> world (100, 50+20=70)
    //   -> handle-as-offset = (100-100, 70-50) = (0, 20).
    // Node B anchor (20,0) -> ex=40,ey=0 -> world (100, 50+40=90).
    // Node B in-handle absolute (15,0) -> ex=30,ey=0 -> world (100, 50+30=80)
    //   -> handle-as-offset = (100-100, 80-90) = (0, -10).
    expect(res!.worldD).toBe('M 100 50 C 100 70 100 80 100 90');
  });
});

describe('resolveTextPath — composes through a group ancestor chain', () => {
  it('a group container translation shifts the world path', () => {
    const path: PathData = {
      closed: false,
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
    };
    const asset = createVectorAsset('path', { id: 'path-a', path });
    const group = createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 });
    group.base = { x: 5, y: 7, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
    const target = createSceneObject('path-a', {
      id: 'p',
      parentId: 'g',
      anchorX: 0,
      anchorY: 0,
      base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    });
    const text = textObjWith({ textPath: { pathObjectId: 'p', startOffset: 0 } });
    const project: Project = { ...createProject(), objects: [group, target], assets: [asset] };
    const res = resolveTextPath(project, text, 0);
    expect(res).not.toBeNull();
    expect(res!.worldD).toBe('M 5 7 L 15 7');
  });
});

describe('resolveTextPath — offset resolution (track wins over base)', () => {
  function boundText(overrides: Partial<SceneObject> = {}): [SceneObject, SceneObject, VectorAsset] {
    const path: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }] };
    const asset = createVectorAsset('path', { id: 'path-a', path });
    const target = createSceneObject('path-a', { id: 'p' });
    const text = textObjWith({ textPath: { pathObjectId: 'p', startOffset: 0.9 }, ...overrides });
    return [text, target, asset];
  }

  it('uses the raw base startOffset when there is no track', () => {
    const [text, target, asset] = boundText();
    const res = resolveTextPath(proj([target, asset]), text, 0);
    expect(res!.startOffset).toBe(0.9);
  });

  it('uses the track value (interpolated) when tracks.textPathOffset is non-empty, ignoring the base', () => {
    const [text, target, asset] = boundText({
      tracks: { textPathOffset: [createKeyframe(0, 0.2), createKeyframe(1, 0.8)] },
    });
    const resAt0 = resolveTextPath(proj([target, asset]), text, 0);
    const resAtHalf = resolveTextPath(proj([target, asset]), text, 0.5);
    expect(resAt0!.startOffset).toBeCloseTo(0.2, 6);
    expect(resAtHalf!.startOffset).toBeCloseTo(0.5, 6);
  });

  it('does not clamp/wrap an out-of-[0,1] raw base offset', () => {
    const [text, target, asset] = boundText({ textPath: { pathObjectId: 'p', startOffset: 1.5 } });
    const res = resolveTextPath(proj([target, asset]), text, 0);
    expect(res!.startOffset).toBe(1.5);
  });
});

describe('resolveTextPath — morphing target', () => {
  it('worldD differs across time when the bound path has a shapeTrack', () => {
    const asset = createVectorAsset('path', {
      id: 'path-a',
      path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }] },
    });
    const target = createSceneObject('path-a', {
      id: 'p',
      shapeTrack: [
        { time: 0, path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }] }, easing: 'linear' },
        { time: 1, path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 40, y: 0 } }] }, easing: 'linear' },
      ],
    });
    const text = textObjWith({ textPath: { pathObjectId: 'p', startOffset: 0 } });
    const project = proj([target, asset]);
    const at0 = resolveTextPath(project, text, 0);
    const at1 = resolveTextPath(project, text, 1);
    expect(at0!.worldD).not.toBe(at1!.worldD);
    expect(at1!.worldD).toBe('M 0 0 L 40 0');
  });
});
