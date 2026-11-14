// Bone skinning (spec 2026-11-14-bone-skinning): the runtime, the static export and the SMIL export
// all draw a skinned path bent by its bones, through the one engine deformation.
import { describe, expect, it } from 'vitest';
import { computeSkin, createGroupObject, createProject, createSceneObject, createVectorAsset, pathToD, type PathData, type Project, type SceneObject } from '@savig/engine';
import { computeFrame } from '@savig/runtime/frame';
import { renderAnimatedSvgDocument } from './animatedSvg';
import { renderProjectDocument } from './renderDocument';

const bar: PathData = {
  closed: true,
  nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 200, y: 0 } }, { anchor: { x: 200, y: 20 } }, { anchor: { x: 0, y: 20 } }],
};

/** Two bones along a 200×20 bar; the lower bone bends 0→90° over 1s (rest at t=0 unless `bent0`). */
function rig(bent0 = 0): Project {
  const p = createProject({ fps: 10, width: 400, height: 400 });
  const lin = 'linear' as const;
  const bone = (id: string, x: number, parentId?: string, track?: SceneObject['tracks']): SceneObject => ({
    ...createGroupObject({ id, anchorX: x, anchorY: 100, zOrder: 0 }),
    bone: { length: 100, angle: 0 },
    ...(parentId ? { parentId } : {}),
    ...(track ? { tracks: track } : {}),
  });
  p.objects.push(bone('upper', 50), bone('lower', 150, 'upper', { rotation: [{ time: 0, value: bent0, easing: lin }, { time: 1, value: 90, easing: lin }] }));
  const asset = createVectorAsset('path', { id: 'pa', path: bar });
  const obj = createSceneObject('pa', { id: 'tail', zOrder: 2, anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5, base: { x: 50, y: 90, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
  // Bind at rest (bones' base, before the track exists).
  const rest = p.objects.map((o) => ({ ...o, tracks: {} }));
  const r = computeSkin(rest, obj, bar, ['upper', 'lower'], 0);
  if ('error' in r) throw new Error(r.error);
  p.assets.push({ ...asset, path: r.path });
  p.objects.push({ ...obj, skin: r.skin });
  return p;
}

const dOf = (p: Project, t: number) => computeFrame(p, t).find((i) => i.objectId === 'tail')!.pathD!;

describe('skinned path render', () => {
  it('the runtime bends the outline with the bones', () => {
    const p = rig();
    expect(dOf(p, 0)).toBe(pathToD((p.assets.find((a) => a.id === 'pa') as { path: PathData }).path));
    expect(dOf(p, 1)).not.toBe(dOf(p, 0));
  });

  it('the static export starts on frame 0 of the deformation (parity with the runtime)', () => {
    const p = rig(45);
    const doc = renderProjectDocument(p);
    expect(doc).toContain(`d="${dOf(p, 0)}"`);
  });

  it('SMIL animates d with a stable skeleton (interpolated, not discrete)', () => {
    const svg = renderAnimatedSvgDocument(rig());
    const anim = svg.match(/<animate[^>]*attributeName="d"[^>]*>/)?.[0];
    expect(anim).toBeDefined();
    expect(anim).not.toMatch(/calcMode="discrete"/);
  });

  it('an unskinned path is untouched (parity)', () => {
    const p = rig();
    const plain = { ...p, objects: p.objects.map((o) => (o.id === 'tail' ? { ...o, skin: undefined } : o)) };
    expect(computeFrame(plain, 1).find((i) => i.objectId === 'tail')!.pathD).toBeUndefined();
  });
});
