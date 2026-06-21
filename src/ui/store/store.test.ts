import { beforeEach } from 'vitest';
import { useEditor } from './store';
import { selectProject, selectDuration, selectSelectedObject, selectEditablePath } from './selectors';
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

  it('nudgeSelected is blocked when auto-key is off', () => {
    useEditor.getState().toggleAutoKey(); // off
    useEditor.getState().nudgeSelected(5, 5);
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

describe('activeTool', () => {
  it('defaults to select and can be changed', () => {
    expect(useEditor.getState().activeTool).toBe('select');
    useEditor.getState().setActiveTool('rect');
    expect(useEditor.getState().activeTool).toBe('rect');
  });

  it('resets to select on newProject', () => {
    useEditor.getState().setActiveTool('ellipse');
    useEditor.getState().newProject();
    expect(useEditor.getState().activeTool).toBe('select');
  });
});

describe('addVectorShape', () => {
  it('creates a rect asset+object in one undo step and selects it', () => {
    useEditor.getState().newProject();
    const before = useEditor.getState().history;
    useEditor.getState().addVectorShape('rect', { x: 10, y: 20, width: 100, height: 50 });
    const s = useEditor.getState();
    const project = s.history.present;
    expect(project.assets).toHaveLength(1);
    expect(project.assets[0].kind).toBe('vector');
    expect(project.objects).toHaveLength(1);
    const obj = project.objects[0];
    expect(obj.assetId).toBe(project.assets[0].id);
    expect(obj.anchorMode).toBe('fraction');
    expect(obj.base.x).toBe(10);
    expect(obj.base.y).toBe(20);
    expect(obj.shapeBase).toEqual({ width: 100, height: 50 });
    expect(s.selectedObjectId).toBe(obj.id);
    expect(s.activeTool).toBe('select');
    useEditor.getState().undo();
    expect(useEditor.getState().history.present).toEqual(before.present);
  });

  it('stores ellipse geometry as half-bounds radii', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorShape('ellipse', { x: 0, y: 0, width: 60, height: 40 });
    expect(useEditor.getState().history.present.objects[0].shapeBase).toEqual({ radiusX: 30, radiusY: 20 });
  });
});

describe('setVectorStyle', () => {
  it('updates the selected vector object asset style in one commit', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const before = useEditor.getState().history.past.length;
    useEditor.getState().setVectorStyle({ fill: '#00ff00' });
    const asset = useEditor.getState().history.present.assets[0];
    expect(asset.kind === 'vector' && asset.style.fill).toBe('#00ff00');
    expect(useEditor.getState().history.past.length).toBe(before + 1); // exactly one commit
  });
});

describe('addVectorPath', () => {
  it('creates a path asset + object in one undo step, normalized to local origin, node tool active', () => {
    useEditor.getState().newProject();
    const before = useEditor.getState().history.present.objects.length;
    useEditor.getState().addVectorPath({
      nodes: [{ anchor: { x: 100, y: 50 } }, { anchor: { x: 140, y: 90 } }],
      closed: false,
    });

    const st = useEditor.getState();
    const proj = st.history.present;
    expect(proj.objects).toHaveLength(before + 1);
    const obj = proj.objects[proj.objects.length - 1];
    const asset = proj.assets.find((a) => a.id === obj.assetId)!;
    expect(asset.kind).toBe('vector');
    expect(asset.kind === 'vector' && asset.shapeType).toBe('path');
    expect(asset.kind === 'vector' && asset.style).toMatchObject({ fill: 'none', stroke: '#000000', strokeWidth: 2 });
    // normalized: bbox min at origin; base carries the offset
    expect(obj.base.x).toBe(100);
    expect(obj.base.y).toBe(50);
    expect(asset.kind === 'vector' && asset.path!.nodes[0].anchor).toEqual({ x: 0, y: 0 });
    expect(obj.anchorMode).toBe('fraction');
    expect(st.activeTool).toBe('node');
    expect(st.selectedObjectId).toBe(obj.id);

    useEditor.getState().undo();
    expect(useEditor.getState().history.present.objects).toHaveLength(before);
  });

  it('ignores a draft with fewer than 2 nodes', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }], closed: false });
    expect(useEditor.getState().history.present.objects).toHaveLength(0);
  });
});

describe('node edit actions', () => {
  it('deleteSelectedNode removes the selected node of the selected path', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorPath({
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 20, y: 0 } }],
      closed: false,
    });
    useEditor.getState().selectNode(1);
    useEditor.getState().deleteSelectedNode();
    const obj = useEditor.getState().history.present.objects.at(-1)!;
    const asset = useEditor.getState().history.present.assets.find((a) => a.id === obj.assetId)!;
    expect(asset.kind === 'vector' && asset.path!.nodes).toHaveLength(2);
  });
});

describe('selectEditablePath', () => {
  it('returns the asset base when there is no shape track', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorPath({
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
      closed: false,
    });
    const path = selectEditablePath(useEditor.getState());
    expect(path?.nodes).toHaveLength(2);
    expect(path?.nodes[1].anchor.x).toBe(10);
  });

  it('returns the sampled shape when a shape track exists', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorPath({
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
      closed: false,
    });
    const objId = useEditor.getState().selectedObjectId!;
    const project = useEditor.getState().history.present;
    const obj = project.objects.find((o) => o.id === objId)!;
    const k0 = { time: 0, easing: 'linear' as const, path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }] } };
    const k2 = { time: 2, easing: 'linear' as const, path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 30, y: 0 } }] } };
    useEditor.getState().commit({ ...project, objects: project.objects.map((o) => (o.id === obj.id ? { ...obj, shapeTrack: [k0, k2] } : o)) });
    useEditor.getState().seek(1);
    expect(selectEditablePath(useEditor.getState())?.nodes[1].anchor.x).toBe(20);
  });
});

function newPath2() {
  useEditor.getState().newProject();
  useEditor.getState().addVectorPath({
    nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
    closed: false,
  });
}
function selectedObj() {
  const s = useEditor.getState();
  return s.history.present.objects.find((o) => o.id === s.selectedObjectId)!;
}
function selectedAsset() {
  const s = useEditor.getState();
  const obj = selectedObj();
  return s.history.present.assets.find((a) => a.id === obj.assetId)!;
}

describe('shape keyframe store actions', () => {
  it('setPathData writes the base when there is no shape track', () => {
    newPath2();
    useEditor.getState().setPathData({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 99, y: 0 } }] });
    const asset = selectedAsset();
    expect(selectedObj().shapeTrack).toBeFalsy();
    expect(asset.kind === 'vector' && asset.path!.nodes[1].anchor.x).toBe(99);
  });

  it('addShapeKeyframe creates a track seeded from the base; setPathData then keys the playhead', () => {
    newPath2();
    useEditor.getState().addShapeKeyframe();
    expect(selectedObj().shapeTrack).toHaveLength(1);
    useEditor.getState().seek(1);
    useEditor.getState().setPathData({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 50, y: 0 } }] });
    const obj = selectedObj();
    expect(obj.shapeTrack).toHaveLength(2);
    expect(obj.shapeTrack!.map((k) => k.time)).toEqual([0, 1]);
    const asset = selectedAsset();
    expect(asset.kind === 'vector' && asset.path!.nodes[1].anchor.x).toBe(10);
  });

  it('removeShapeKeyframe of the last keyframe writes it back to the base and drops the track', () => {
    newPath2();
    useEditor.getState().addShapeKeyframe();
    useEditor.getState().setPathData({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 77, y: 0 } }] });
    useEditor.getState().removeShapeKeyframe();
    expect(selectedObj().shapeTrack).toBeFalsy();
    const asset = selectedAsset();
    expect(asset.kind === 'vector' && asset.path!.nodes[1].anchor.x).toBe(77);
  });

  it('selectShapeKeyframe and selectKeyframe clear each other', () => {
    newPath2();
    useEditor.getState().selectShapeKeyframe({ objectId: selectedObj().id, time: 0 });
    expect(useEditor.getState().selectedShapeKeyframe).not.toBeNull();
    useEditor.getState().selectKeyframe({ objectId: selectedObj().id, property: 'x', time: 0 });
    expect(useEditor.getState().selectedShapeKeyframe).toBeNull();
    useEditor.getState().selectShapeKeyframe({ objectId: selectedObj().id, time: 0 });
    expect(useEditor.getState().selectedKeyframe).toBeNull();
  });
});

describe('node edits while morphing key the playhead, not the base', () => {
  it('deleteSelectedNode upserts a shape keyframe and leaves the base intact', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorPath({
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 20, y: 0 } }],
      closed: false,
    });
    useEditor.getState().addShapeKeyframe();
    useEditor.getState().seek(1);
    useEditor.getState().selectNode(1);
    useEditor.getState().deleteSelectedNode();
    const obj = selectedObj();
    const asset = selectedAsset();
    const kf = obj.shapeTrack!.find((k) => k.time === 1)!;
    expect(kf.path.nodes).toHaveLength(2);
    expect(asset.kind === 'vector' && asset.path!.nodes).toHaveLength(3);
  });
});

describe('removeShapeKeyframe robustness', () => {
  it('clears a stale shape-keyframe selection when there is nothing to remove at it', () => {
    newPath2();
    useEditor.getState().addShapeKeyframe();              // kf at t=0
    const id = selectedObj().id;
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: 5 }); // stale (no kf at 5)
    useEditor.getState().seek(3);                         // playhead also off any kf
    useEditor.getState().removeShapeKeyframe();
    expect(useEditor.getState().selectedShapeKeyframe).toBeNull();
    // the real keyframe at t=0 is untouched
    expect(selectedObj().shapeTrack).toHaveLength(1);
  });
});

describe('keyframe easing editing', () => {
  beforeEach(() => {
    useEditor.getState().newProject();
    useEditor.getState().addAsset(svgAsset);
    useEditor.getState().addObject('asset-a');
  });

  it('setSelectedKeyframeEasing edits the selected scalar keyframe (one undo step)', () => {
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('x', 10);
    const id = selectSelectedObject(useEditor.getState())!.id;
    const t = selectSelectedObject(useEditor.getState())!.tracks.x![0].time;
    useEditor.getState().selectKeyframe({ objectId: id, property: 'x', time: t });
    const before = useEditor.getState().history.past.length;
    useEditor.getState().setSelectedKeyframeEasing('easeIn');
    expect(selectSelectedObject(useEditor.getState())!.tracks.x![0].easing).toBe('easeIn');
    expect(useEditor.getState().history.past.length).toBe(before + 1);
    useEditor.getState().undo();
    expect(selectSelectedObject(useEditor.getState())!.tracks.x![0].easing).not.toBe('easeIn');
  });

  it('setSelectedKeyframeEasing edits the selected shape keyframe', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
    useEditor.getState().addShapeKeyframe();
    const id = useEditor.getState().selectedObjectId!;
    const t = selectSelectedObject(useEditor.getState())!.shapeTrack![0].time;
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: t });
    useEditor.getState().setSelectedKeyframeEasing({ type: 'cubicBezier', p1: 0.4, p2: 0, p3: 0.6, p4: 1 });
    expect(selectSelectedObject(useEditor.getState())!.shapeTrack![0].easing).toEqual(
      { type: 'cubicBezier', p1: 0.4, p2: 0, p3: 0.6, p4: 1 },
    );
  });

  it('setSelectedKeyframeRotationMode writes only on a rotation keyframe', () => {
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('rotation', 90);
    const id = selectSelectedObject(useEditor.getState())!.id;
    useEditor.getState().selectKeyframe({ objectId: id, property: 'rotation', time: 0 });
    useEditor.getState().setSelectedKeyframeRotationMode('raw');
    expect(selectSelectedObject(useEditor.getState())!.tracks.rotation![0].rotationMode).toBe('raw');
  });

  it('setSelectedKeyframeRotationMode is a no-op for a non-rotation keyframe', () => {
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('x', 5);
    const id = selectSelectedObject(useEditor.getState())!.id;
    useEditor.getState().selectKeyframe({ objectId: id, property: 'x', time: 0 });
    useEditor.getState().setSelectedKeyframeRotationMode('raw');
    expect(selectSelectedObject(useEditor.getState())!.tracks.x![0].rotationMode).toBeUndefined();
  });

  it('selectKeyframe also selects the object', () => {
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('x', 5);
    const id = selectSelectedObject(useEditor.getState())!.id;
    useEditor.getState().selectObject(null);
    useEditor.getState().selectKeyframe({ objectId: id, property: 'x', time: 0 });
    expect(useEditor.getState().selectedObjectId).toBe(id);
  });

  it('selectShapeKeyframe also selects the object', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
    useEditor.getState().addShapeKeyframe();
    const id = useEditor.getState().selectedObjectId!;
    const t = selectSelectedObject(useEditor.getState())!.shapeTrack![0].time;
    useEditor.getState().selectObject(null);
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: t });
    expect(useEditor.getState().selectedObjectId).toBe(id);
  });

  it('setSelectedShapeKeyframeMorph writes morph on the selected shape keyframe (one undo)', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
    useEditor.getState().addShapeKeyframe();
    const id = useEditor.getState().selectedObjectId!;
    const t = selectSelectedObject(useEditor.getState())!.shapeTrack![0].time;
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: t });
    const before = useEditor.getState().history.past.length;
    useEditor.getState().setSelectedShapeKeyframeMorph('resampled');
    expect(selectSelectedObject(useEditor.getState())!.shapeTrack![0].morph).toBe('resampled');
    expect(useEditor.getState().history.past.length).toBe(before + 1);
    useEditor.getState().undo();
    expect(selectSelectedObject(useEditor.getState())!.shapeTrack![0].morph).toBeUndefined();
  });

  it('setSelectedShapeKeyframeMorph is a no-op when no shape keyframe is selected', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
    const before = useEditor.getState().history.past.length;
    useEditor.getState().setSelectedShapeKeyframeMorph('resampled');
    expect(useEditor.getState().history.past.length).toBe(before);
  });
});

describe('setSelectedShapeKeyframeCorrespondence', () => {
  it('writes (and clears) the map on the selected shape keyframe, one undo step', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorPath({
      nodes: [
        { anchor: { x: 0, y: 0 } },
        { anchor: { x: 10, y: 0 } },
        { anchor: { x: 10, y: 10 } },
        { anchor: { x: 0, y: 10 } },
      ],
      closed: true,
    });
    s.addShapeKeyframe();
    s.seek(1);
    s.addShapeKeyframe();
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });

    const before = useEditor.getState().history.past.length;
    useEditor.getState().setSelectedShapeKeyframeCorrespondence([1, 2, 3, 0]);
    const kf0 = () => useEditor.getState().history.present.objects[0].shapeTrack![0];
    expect(kf0().correspondence).toEqual([1, 2, 3, 0]);
    expect(useEditor.getState().history.past.length).toBe(before + 1); // exactly one undo step

    useEditor.getState().undo();
    expect(kf0().correspondence).toBeUndefined();

    useEditor.getState().redo();
    useEditor.getState().setSelectedShapeKeyframeCorrespondence(undefined);
    expect(kf0().correspondence).toBeUndefined();
  });

  it('is a no-op when no shape keyframe is selected', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
    const before = useEditor.getState().history.past.length;
    useEditor.getState().setSelectedShapeKeyframeCorrespondence([0, 1]);
    expect(useEditor.getState().history.past.length).toBe(before);
  });
});
