import { beforeEach } from 'vitest';
import { useEditor } from './store';
import { selectProject, selectDuration, selectSelectedObject } from './selectors';
import { createProject, sampleObject } from '../../engine';
import type { SvgAsset } from '../../engine';

beforeEach(() => {
  useEditor.getState().newProject();
});

describe('store history core', () => {
  it('starts with an empty Untitled project', () => {
    const p = selectProject(useEditor.getState());
    expect(p.meta.name).toBe('Untitled');
    expect(p.objects).toEqual([]);
    expect(selectDuration(useEditor.getState())).toBe(0);
  });

  it('commit advances present and is undoable/redoable', () => {
    const base = selectProject(useEditor.getState());
    useEditor.getState().commit({ ...base, meta: { ...base.meta, name: 'Renamed' } });
    expect(selectProject(useEditor.getState()).meta.name).toBe('Renamed');

    useEditor.getState().undo();
    expect(selectProject(useEditor.getState()).meta.name).toBe('Untitled');

    useEditor.getState().redo();
    expect(selectProject(useEditor.getState()).meta.name).toBe('Renamed');
  });

  it('setProject resets history (cannot undo past a load)', () => {
    useEditor.getState().setProject(createProject({ name: 'Loaded' }));
    useEditor.getState().undo();
    expect(selectProject(useEditor.getState()).meta.name).toBe('Loaded');
  });

  it('setProject keeps the loaded binaries (not reset to empty)', () => {
    const bytes = new Uint8Array([9, 8, 7]);
    useEditor.getState().setProject(createProject({ name: 'Loaded' }), { aud: bytes });
    expect(useEditor.getState().binaries['aud']).toBe(bytes);
  });
});

const svgAsset: SvgAsset = {
  id: 'asset-a', kind: 'svg', name: 'Box',
  normalizedContent: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  viewBox: '0 0 100 80', width: 100, height: 80,
};

describe('store assets & objects', () => {
  it('addAsset dedupes by content id', () => {
    useEditor.getState().addAsset(svgAsset);
    useEditor.getState().addAsset(svgAsset);
    expect(selectProject(useEditor.getState()).assets).toHaveLength(1);
  });

  it('addObject instances the asset, centers anchor, and selects it', () => {
    useEditor.getState().addAsset(svgAsset);
    useEditor.getState().addObject('asset-a');
    const obj = selectSelectedObject(useEditor.getState());
    expect(obj).not.toBeNull();
    expect(obj!.assetId).toBe('asset-a');
    expect(obj!.anchorX).toBe(50);
    expect(obj!.anchorY).toBe(40);
    expect(obj!.zOrder).toBe(0);
  });

  it('stores audio bytes outside history', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    useEditor.getState().addAsset(
      { id: 'aud', kind: 'audio', name: 'clip', mimeType: 'audio/mpeg' },
      bytes,
    );
    expect(useEditor.getState().binaries['aud']).toBe(bytes);
  });

  it('selectObject(null) deselects and clears the keyframe selection', () => {
    useEditor.getState().addAsset(svgAsset);
    useEditor.getState().addObject('asset-a');
    useEditor.getState().selectKeyframe({ objectId: selected().id, property: 'x', time: 0 });
    useEditor.getState().selectObject(null);
    expect(useEditor.getState().selectedObjectId).toBeNull();
    expect(useEditor.getState().selectedKeyframe).toBeNull();
  });
});

function selected() {
  return selectSelectedObject(useEditor.getState())!;
}

describe('store editing & transport', () => {
  beforeEach(() => {
    useEditor.getState().addAsset(svgAsset);
    useEditor.getState().addObject('asset-a');
  });

  it('setProperty with auto-key on creates a keyframe at the snapped playhead', () => {
    useEditor.getState().seek(0.5);
    useEditor.getState().setProperty('x', 120);
    const track = selected().tracks.x!;
    expect(track).toHaveLength(1);
    expect(track[0].value).toBe(120);
    expect(track[0].time).toBeCloseTo(0.5, 5);
  });

  it('setProperty is blocked when auto-key is off', () => {
    useEditor.getState().toggleAutoKey(); // -> off
    useEditor.getState().setProperty('x', 99);
    expect(selected().tracks.x).toBeUndefined();
  });

  it('removeSelectedKeyframe deletes the selected keyframe', () => {
    useEditor.getState().setProperty('x', 10);
    const t = selected().tracks.x![0].time;
    useEditor.getState().selectKeyframe({ objectId: selected().id, property: 'x', time: t });
    useEditor.getState().removeSelectedKeyframe();
    expect(selected().tracks.x).toEqual([]);
    expect(useEditor.getState().selectedKeyframe).toBeNull();
  });

  it('nudgeSelected offsets the sampled x by dx (auto-keying)', () => {
    useEditor.getState().seek(0);
    useEditor.getState().nudgeSelected(5, 0);
    expect(sampleObject(selected(), 0).x).toBe(5);
  });

  it('a diagonal nudge is a single undo step', () => {
    useEditor.getState().seek(0);
    useEditor.getState().nudgeSelected(5, 7);
    expect(sampleObject(selected(), 0).x).toBe(5);
    expect(sampleObject(selected(), 0).y).toBe(7);
    useEditor.getState().undo();
    expect(selected().tracks.x).toBeUndefined();
    expect(selected().tracks.y).toBeUndefined();
  });

  it('undo/redo round-trips a setProperty edit', () => {
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('x', 33);
    expect(selected().tracks.x).toHaveLength(1);
    useEditor.getState().undo();
    expect(selected().tracks.x).toBeUndefined();
    useEditor.getState().redo();
    expect(selected().tracks.x![0].value).toBe(33);
  });

  it('seek clamps to the upper duration bound', () => {
    useEditor.getState().seek(1);
    useEditor.getState().setProperty('x', 1); // keyframe at t=1 -> duration 1
    useEditor.getState().seek(99);
    expect(useEditor.getState().time).toBe(1);
  });

  it('seek clamps to project duration', () => {
    useEditor.getState().setProperty('x', 1);
    useEditor.getState().seek(-3);
    expect(useEditor.getState().time).toBe(0);
  });

  it('setAnchor updates the selected object anchor', () => {
    useEditor.getState().setAnchor(7, 9);
    expect(selected().anchorX).toBe(7);
    expect(selected().anchorY).toBe(9);
  });

  it('stepFrame advances one frame at the project fps', () => {
    useEditor.getState().seek(0);
    useEditor.getState().stepFrame(1);
    expect(useEditor.getState().time).toBeCloseTo(1 / 30, 5);
  });

  it('addAudioClip appends a clip at the playhead', () => {
    useEditor.getState().addAsset({ id: 'aud', kind: 'audio', name: 'song', mimeType: 'audio/mpeg' }, new Uint8Array([1]));
    useEditor.getState().seek(2);
    useEditor.getState().addAudioClip('aud');
    const clips = selectProject(useEditor.getState()).audioClips;
    expect(clips).toHaveLength(1);
    expect(clips[0].startTime).toBe(2);
    expect(clips[0].assetId).toBe('aud');
  });
});

describe('store toasts', () => {
  it('push then dismiss', () => {
    useEditor.getState().pushToast('error', 'Boom');
    const t = useEditor.getState().toasts;
    expect(t).toHaveLength(1);
    expect(t[0].message).toBe('Boom');
    useEditor.getState().dismissToast(t[0].id);
    expect(useEditor.getState().toasts).toHaveLength(0);
  });
});
