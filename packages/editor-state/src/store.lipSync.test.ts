import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { createGroupObject, createSceneObject, createSymbolAsset, lipSyncPoses } from '@savig/engine';
import type { SceneObject } from '@savig/engine';

beforeEach(() => store.getState().newProject());

function seedMouth(keys = 3, labels: (string | undefined)[] = []): string {
  const layer: SceneObject = {
    ...createGroupObject({ id: 'mouth-layer', anchorX: 0, anchorY: 0, zOrder: 0 }),
    frames: { keys: Array.from({ length: keys }, (_, i) => ({ id: `k${i}`, time: i / 24, ...(labels[i] ? { label: labels[i] } : {}) })), end: keys / 24 },
  };
  const sym = createSymbolAsset({ id: 'mouth', name: 'Mouth', objects: [layer], width: 10, height: 10 });
  const inst = createSceneObject('mouth', { id: 'm1', name: 'Mouth 1', zOrder: 0 });
  const p = store.getState().history.present;
  store.getState().commit({ ...p, assets: [...p.assets, sym], objects: [inst] });
  return inst.id;
}

const obj = (id: string) => store.getState().history.present.objects.find((o) => o.id === id)!;

describe('applyLipSync', () => {
  it('keys the instance time remap from the levels and is one undo step', () => {
    const id = seedMouth(3);
    const levels = [0, 0, 1, 1, 1, 0.5, 0.5, 0, 0];
    expect(store.getState().applyLipSync(id, { levels, startTime: 0.5 })).toBe(3);
    const track = obj(id).symbolTimeTrack!;
    expect(track[0]).toMatchObject({ time: 0, value: 0 });
    const poses = lipSyncPoses(levels, 3);
    const widest = poses.indexOf(2);
    // At the first loud frame, the remap shows the widest pose (key k2 at 2/24 s).
    const t = 0.5 + widest / store.getState().history.present.meta.fps;
    const k = track.find((x) => Math.abs(x.time - t) < 1e-9)!;
    expect(k.value).toBeCloseTo(2 / 24, 9);
    expect(track[track.length - 1].value).toBe(0);
    store.getState().undo();
    expect(obj(id).symbolTimeTrack).toBeUndefined();
  });

  it('refuses non-instances, single-pose symbols and silent clips', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const rect = store.getState().selectedObjectId!;
    expect(store.getState().applyLipSync(rect, { levels: [1], startTime: 0 })).toBe(0);
    store.getState().newProject();
    const one = seedMouth(1);
    expect(store.getState().applyLipSync(one, { levels: [1, 1], startTime: 0 })).toBe(0);
    store.getState().newProject();
    const id = seedMouth(3);
    expect(store.getState().applyLipSync(id, { levels: [], startTime: 0 })).toBe(0);
    expect(store.getState().toasts.length).toBeGreaterThan(0);
  });

  it('vowel shapes pick the pose each frame label names, resting on the "rest" pose', () => {
    // Poses: 0 = "Ah", 1 = "Rest", 2 = "Oh", 3 = "Ee" (rest is NOT first).
    const id = seedMouth(4, ['Ah', 'Rest', 'Oh', 'Ee']);
    const levels = [0, 1, 1, 1, 1, 1, 1, 0, 0];
    const vowels = ['AI', 'AI', 'AI', 'O', 'O', 'E', 'E', 'E', 'E'] as const;
    expect(store.getState().applyLipSync(id, { levels, startTime: 0, vowels: [...vowels], minHold: 1 })).toBe(4);
    const track = obj(id).symbolTimeTrack!;
    const fps = store.getState().history.present.meta.fps;
    const at = (f: number) => {
      let v = track[0].value;
      for (const k of track) if (k.time <= f / fps + 1e-9) v = k.value;
      return Math.round(v * 24);
    };
    expect([0, 1, 3, 5, 7].map(at)).toEqual([1, 0, 2, 3, 1]);
    expect(track[track.length - 1].value).toBeCloseTo(1 / 24, 9);
  });
});
