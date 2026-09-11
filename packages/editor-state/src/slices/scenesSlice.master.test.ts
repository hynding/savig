// In-editor master-timeline preview/scrub (the M5-era deferral): a TRANSIENT masterPreview flag
// (mirrors previewMode — never in history), a seekMaster action that maps a master-timeline time
// onto (scene, local playhead) via the engine's sceneAtTime, and master selectors for the UI.
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../store';
import { selectMasterDuration, selectMasterTime } from '../selectors';

beforeEach(() => store.getState().newProject());

/** Two scenes: s1 (2s) and s2 (3s), cut between them → spans s1 [0,2), s2 [2,5). */
function twoScenes(): { s1: string; s2: string } {
  store.getState().addScene(); // promotes root to scene 1 + adds & selects scene 2
  const scenes = store.getState().history.present.scenes!;
  const [a, b] = scenes;
  store.getState().setSceneDuration(a.id, 2);
  store.getState().setSceneDuration(b.id, 3);
  store.getState().selectScene(a.id);
  return { s1: a.id, s2: b.id };
}

describe('masterPreview flag', () => {
  it('defaults false and toggles transiently (no history entry)', () => {
    expect(store.getState().masterPreview).toBe(false);
    const pastBefore = store.getState().history.past.length;
    store.getState().toggleMasterPreview();
    expect(store.getState().masterPreview).toBe(true);
    store.getState().toggleMasterPreview();
    expect(store.getState().masterPreview).toBe(false);
    expect(store.getState().history.past.length).toBe(pastBefore);
  });
});

describe('seekMaster', () => {
  it('maps a master time inside another scene onto (that scene, local time)', () => {
    const { s2 } = twoScenes();
    store.getState().seekMaster(3.5); // s2 spans [2,5)
    expect(store.getState().selectedSceneId).toBe(s2);
    expect(store.getState().time).toBeCloseTo(1.5, 6);
  });

  it('within the ACTIVE scene it just seeks — selection and editPath untouched', () => {
    twoScenes();
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const objId = store.getState().selectedObjectId!;
    store.getState().seekMaster(0.5);
    expect(store.getState().time).toBeCloseTo(0.5, 6);
    expect(store.getState().selectedObjectId).toBe(objId);
  });

  it('a scene CHANGE clears object selection and editPath (selectScene invariants, but keeps the mapped time)', () => {
    const { s2 } = twoScenes();
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    expect(store.getState().selectedObjectId).not.toBeNull();
    store.getState().seekMaster(4);
    expect(store.getState().selectedSceneId).toBe(s2);
    expect(store.getState().selectedObjectId).toBeNull();
    expect(store.getState().selectedObjectIds).toEqual([]);
    expect(store.getState().editPath).toEqual([]);
    expect(store.getState().time).toBeCloseTo(2, 6);
  });

  it('clamps to [0, master duration]', () => {
    const { s1, s2 } = twoScenes();
    store.getState().seekMaster(99);
    expect(store.getState().selectedSceneId).toBe(s2);
    expect(store.getState().time).toBeCloseTo(3, 6); // pinned to the last scene end
    store.getState().seekMaster(-5);
    expect(store.getState().selectedSceneId).toBe(s1);
    expect(store.getState().time).toBe(0);
  });

  it('is a plain seek on a single-scene project (still clamped to the project duration)', () => {
    // Give the single-scene project a nonzero duration via a master-timeline audio clip.
    const p = store.getState().history.present;
    store.getState().setProject({
      ...p,
      assets: [{ id: 'au', kind: 'audio', name: 'a.wav', mimeType: 'audio/wav', duration: 2 }],
    });
    store.getState().addAudioClip('au');
    store.getState().seekMaster(0.25);
    expect(store.getState().time).toBeCloseTo(0.25, 6);
    expect(store.getState().history.present.scenes).toBeUndefined();
    store.getState().seekMaster(99);
    expect(store.getState().time).toBeCloseTo(2, 6); // clamped to the project duration
  });

  it('mid-transition the INCOMING scene wins (sceneAtTime integration)', () => {
    const { s2 } = twoScenes();
    store.getState().setSceneTransition(s2, { kind: 'crossfade', duration: 1 }); // s2 span pulls back to [1,4)
    store.getState().seekMaster(1.5);
    expect(store.getState().selectedSceneId).toBe(s2);
    expect(store.getState().time).toBeCloseTo(0.5, 6);
  });
});

describe('master selectors', () => {
  it('selectMasterDuration spans all scenes (with transition overlap folded in)', () => {
    const { s2 } = twoScenes();
    expect(selectMasterDuration(store.getState())).toBeCloseTo(5, 6);
    store.getState().setSceneTransition(s2, { kind: 'crossfade', duration: 1 });
    expect(selectMasterDuration(store.getState())).toBeCloseTo(4, 6);
  });

  it('selectMasterTime = active span start + local playhead', () => {
    const { s2 } = twoScenes();
    store.getState().selectScene(s2);
    store.getState().seek(1);
    expect(selectMasterTime(store.getState())).toBeCloseTo(3, 6); // 2 + 1
  });

  it('selectMasterTime passes the local playhead through on a single-scene project', () => {
    store.getState().seek(0.75);
    expect(selectMasterTime(store.getState())).toBe(store.getState().time);
  });
});
