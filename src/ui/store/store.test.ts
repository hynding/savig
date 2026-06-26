import { beforeEach } from 'vitest';
import { useEditor } from './store';
import { objectAABB } from '../components/Stage/snapping';
import { selectProject, selectDuration, selectSelectedObject, selectEditablePath, selectActiveObjects } from './selectors';
import { createProject, createSceneObject, createSymbolAsset, createVectorAsset, sampleObject } from '../../engine';
import type { Asset, Gradient, PathData, SvgAsset, VectorAsset } from '../../engine';

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

describe('setVectorGradient', () => {
  it('sets and clears a static fill gradient on the selected vector asset (autoKey off)', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    useEditor.getState().toggleAutoKey(); // off -> static gradient authoring
    const grad = {
      type: 'linear' as const,
      x1: 0,
      y1: 0.5,
      x2: 1,
      y2: 0.5,
      stops: [
        { offset: 0, color: '#000000' },
        { offset: 1, color: '#ffffff' },
      ],
    };
    useEditor.getState().setVectorGradient('fill', grad);
    let asset = useEditor.getState().history.present.assets[0];
    expect(asset.kind === 'vector' && asset.style.fillGradient).toEqual(grad);

    useEditor.getState().setVectorGradient('fill', undefined);
    asset = useEditor.getState().history.present.assets[0];
    expect(asset.kind === 'vector' && asset.style.fillGradient).toBeUndefined();
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

describe('correspondence edit mode', () => {
  function seedTwoShapeKfs() {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorPath({
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 5, y: 9 } }],
      closed: true,
    });
    s.addShapeKeyframe();
    s.seek(1);
    s.addShapeKeyframe();
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
    return id;
  }

  it('enter/exitCorrespondenceEdit toggles the flag', () => {
    seedTwoShapeKfs();
    useEditor.getState().enterCorrespondenceEdit();
    expect(useEditor.getState().correspondenceEditing).toBe(true);
    useEditor.getState().exitCorrespondenceEdit();
    expect(useEditor.getState().correspondenceEditing).toBe(false);
  });

  it('switching away from the node tool clears correspondenceEditing', () => {
    seedTwoShapeKfs();
    useEditor.getState().enterCorrespondenceEdit();
    expect(useEditor.getState().correspondenceEditing).toBe(true);
    useEditor.getState().setActiveTool('select');
    expect(useEditor.getState().correspondenceEditing).toBe(false);
    // re-entering the node tool does not auto-enable it
    useEditor.getState().setActiveTool('node');
    expect(useEditor.getState().correspondenceEditing).toBe(false);
  });

  it('setCorrespondenceLink seeds identity then sets one link, one undo step', () => {
    seedTwoShapeKfs();
    const kf0 = () => useEditor.getState().history.present.objects[0].shapeTrack![0];
    const before = useEditor.getState().history.past.length;
    useEditor.getState().setCorrespondenceLink(2, 0); // a2 -> b0
    // n == 3 (to-path nodes); identity is [0,1,2], then c[2]=0 => [0,1,0].
    expect(kf0().correspondence).toEqual([0, 1, 0]);
    expect(useEditor.getState().history.past.length).toBe(before + 1);
  });
});

describe('node edits preserve keyframe fields + align nodeEasings', () => {
  function seedKf() {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 5, y: 9 } }], closed: true });
    s.addShapeKeyframe(); // kf@0
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
  }

  it('a path edit preserves the keyframe easing and morph (no wipe)', () => {
    seedKf();
    useEditor.getState().setSelectedKeyframeEasing('easeIn');
    useEditor.getState().setSelectedShapeKeyframeMorph('resampled');
    useEditor.getState().setPathData({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }, { anchor: { x: 5, y: 9 } }], closed: true });
    const kf = useEditor.getState().history.present.objects[0].shapeTrack![0];
    expect(kf.easing).toBe('easeIn');
    expect(kf.morph).toBe('resampled');
  });

  it('delete-node splices out the node easing at that index', () => {
    seedKf();
    const proj = useEditor.getState().history.present;
    const obj = proj.objects[0];
    useEditor.getState().commit({ ...proj, objects: [{ ...obj, shapeTrack: [{ ...obj.shapeTrack![0], nodeEasings: ['easeIn', 'linear', 'easeOut'] }] }] });
    useEditor.getState().selectNode(1);
    useEditor.getState().deleteSelectedNode();
    expect(useEditor.getState().history.present.objects[0].shapeTrack![0].nodeEasings).toEqual(['easeIn', 'easeOut']);
  });

  it('insertNode inserts a hole at the new index and selects it', () => {
    seedKf();
    const proj = useEditor.getState().history.present;
    const obj = proj.objects[0];
    useEditor.getState().commit({ ...proj, objects: [{ ...obj, shapeTrack: [{ ...obj.shapeTrack![0], nodeEasings: ['easeIn', 'linear', 'easeOut'] }] }] });
    useEditor.getState().insertNode(0, 0.5); // insert on segment 0 -> new node at index 1
    const kf = useEditor.getState().history.present.objects[0].shapeTrack![0];
    expect(kf.nodeEasings).toEqual(['easeIn', undefined, 'linear', 'easeOut']);
    expect(useEditor.getState().selectedNodeIndex).toBe(1);
  });
});

describe('setSelectedNodeEasing', () => {
  function seedNode() {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
    s.addShapeKeyframe();
    s.seek(0);
    useEditor.getState().selectNode(1);
  }

  it('writes nodeEasings[selectedNodeIndex] on the playhead keyframe, one undo step', () => {
    seedNode();
    const before = useEditor.getState().history.past.length;
    useEditor.getState().setSelectedNodeEasing('easeIn');
    const kf = () => useEditor.getState().history.present.objects[0].shapeTrack![0];
    expect(kf().nodeEasings).toEqual([undefined, 'easeIn']);
    expect(useEditor.getState().history.past.length).toBe(before + 1);
  });

  it('undefined clears the entry and collapses an empty array', () => {
    seedNode();
    useEditor.getState().setSelectedNodeEasing('easeIn');
    useEditor.getState().setSelectedNodeEasing(undefined);
    expect(useEditor.getState().history.present.objects[0].shapeTrack![0].nodeEasings).toBeUndefined();
  });

  it('is a no-op off a keyframe (no shape keyframe at the playhead)', () => {
    seedNode();
    useEditor.getState().seek(0.5); // not on the only keyframe (t=0)
    const before = useEditor.getState().history.past.length;
    useEditor.getState().setSelectedNodeEasing('easeIn');
    expect(useEditor.getState().history.past.length).toBe(before);
  });
});

describe('node-edit nodeEasings alignment edge cases', () => {
  it('deleting from a 2-node path is a no-op (no nodeEasings desync, no undo step)', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
    s.addShapeKeyframe();
    const proj = useEditor.getState().history.present;
    const obj = proj.objects[0];
    useEditor.getState().commit({ ...proj, objects: [{ ...obj, shapeTrack: [{ ...obj.shapeTrack![0], nodeEasings: ['easeIn', 'linear'] }] }] });
    useEditor.getState().seek(0);
    useEditor.getState().selectNode(1);
    const before = useEditor.getState().history.past.length;
    useEditor.getState().deleteSelectedNode();
    const kf = useEditor.getState().history.present.objects[0].shapeTrack![0];
    expect(kf.path.nodes).toHaveLength(2); // deleteNodeAt floor: unchanged
    expect(kf.nodeEasings).toEqual(['easeIn', 'linear']); // still aligned
    expect(useEditor.getState().history.past.length).toBe(before); // no no-op commit
  });

  it('a move preserves correspondence and nodeEasings (full field-preservation contract)', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 5, y: 9 } }], closed: true });
    s.addShapeKeyframe();
    const proj = useEditor.getState().history.present;
    const obj = proj.objects[0];
    useEditor.getState().commit({ ...proj, objects: [{ ...obj, shapeTrack: [{ ...obj.shapeTrack![0], correspondence: [2, 0, 1], nodeEasings: ['easeIn', undefined as unknown as 'linear', 'easeOut'] }] }] });
    useEditor.getState().seek(0);
    useEditor.getState().setPathData({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }, { anchor: { x: 5, y: 9 } }], closed: true });
    const kf = useEditor.getState().history.present.objects[0].shapeTrack![0];
    expect(kf.correspondence).toEqual([2, 0, 1]);
    expect(kf.nodeEasings).toEqual(['easeIn', undefined, 'easeOut']);
  });
});

describe('node edits realign correspondence (polish A)', () => {
  function seedKfWithCorr(corr: number[]) {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 5, y: 9 } }], closed: true });
    s.addShapeKeyframe();
    const proj = useEditor.getState().history.present;
    const obj = proj.objects[0];
    useEditor.getState().commit({ ...proj, objects: [{ ...obj, shapeTrack: [{ ...obj.shapeTrack![0], correspondence: corr }] }] });
    useEditor.getState().seek(0);
  }

  it('insertNode realigns correspondence (new node inherits predecessor target; stays valid length)', () => {
    seedKfWithCorr([2, 0, 1]);
    useEditor.getState().insertNode(0, 0.5); // new node at index 1, inherits c[0]=2
    const kf = useEditor.getState().history.present.objects[0].shapeTrack![0];
    expect(kf.correspondence).toEqual([2, 2, 0, 1]);
    expect(kf.correspondence!.length).toBe(kf.path.nodes.length); // map stays valid
  });

  it('delete-node drops the correspondence entry at that index', () => {
    seedKfWithCorr([2, 0, 1]);
    useEditor.getState().selectNode(1);
    useEditor.getState().deleteSelectedNode();
    const kf = useEditor.getState().history.present.objects[0].shapeTrack![0];
    expect(kf.correspondence).toEqual([2, 1]);
    expect(kf.correspondence!.length).toBe(kf.path.nodes.length);
  });
});

describe('setVectorColor', () => {
  function seedRect() {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
  }
  it('autoKey ON: writes a color keyframe at the playhead (one undo step)', () => {
    seedRect();
    useEditor.getState().seek(1);
    const before = useEditor.getState().history.past.length;
    useEditor.getState().setVectorColor('fill', '#ff0000');
    const obj = useEditor.getState().history.present.objects[0];
    expect(obj.colorTracks?.fill).toEqual([{ time: 1, value: '#ff0000', easing: 'linear' }]);
    expect(useEditor.getState().history.past.length).toBe(before + 1);
  });
  it('autoKey OFF: edits the static asset style, no color track', () => {
    seedRect();
    useEditor.getState().toggleAutoKey();
    useEditor.getState().setVectorColor('fill', '#00ff00');
    const proj = useEditor.getState().history.present;
    const obj = proj.objects[0];
    const asset = proj.assets.find((a) => a.id === obj.assetId)!;
    expect(asset.kind === 'vector' && asset.style.fill).toBe('#00ff00');
    expect(obj.colorTracks?.fill).toBeUndefined();
  });
});

describe('setVectorGradient (animated)', () => {
  const lin = (x2: number): Gradient => ({
    type: 'linear',
    x1: 0,
    y1: 0,
    x2,
    y2: 0,
    stops: [
      { offset: 0, color: '#000000' },
      { offset: 1, color: '#ffffff' },
    ],
  });
  function seedRect(): string {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
    return useEditor.getState().selectedObjectId!;
  }
  const obj = (id: string) => useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  const asset = (id: string) => {
    const proj = useEditor.getState().history.present;
    const a = proj.assets.find((x) => x.id === obj(id).assetId)!;
    if (a.kind !== 'vector') throw new Error('not a vector asset');
    return a;
  };

  it('autoKey on: upserts a gradient keyframe at the snapped playhead', () => {
    const id = seedRect();
    useEditor.getState().seek(1);
    useEditor.getState().setVectorGradient('fill', lin(1));
    expect(obj(id).gradientTracks?.fill).toHaveLength(1);
    expect(obj(id).gradientTracks!.fill![0].time).toBe(1);
  });

  it('autoKey off: writes the static asset gradient, no track', () => {
    const id = seedRect();
    useEditor.getState().toggleAutoKey();
    useEditor.getState().setVectorGradient('fill', lin(1));
    expect(asset(id).style.fillGradient).toEqual(lin(1));
    expect(obj(id).gradientTracks?.fill).toBeUndefined();
  });

  it('undefined clears BOTH the static gradient and the track', () => {
    const id = seedRect();
    useEditor.getState().toggleAutoKey(); // off
    useEditor.getState().setVectorGradient('fill', lin(1)); // static
    useEditor.getState().toggleAutoKey(); // on
    useEditor.getState().seek(0);
    useEditor.getState().setVectorGradient('fill', lin(0.5)); // track
    useEditor.getState().setVectorGradient('fill', undefined); // solid
    expect(asset(id).style.fillGradient).toBeUndefined();
    expect(obj(id).gradientTracks?.fill).toBeUndefined();
  });

  it('removeSelectedGradientKeyframe deletes the selected keyframe', () => {
    const id = seedRect();
    useEditor.getState().seek(0);
    useEditor.getState().setVectorGradient('fill', lin(0));
    useEditor.getState().seek(1);
    useEditor.getState().setVectorGradient('fill', lin(1));
    useEditor.getState().selectGradientKeyframe({ objectId: id, property: 'fill', time: 0 });
    useEditor.getState().removeSelectedGradientKeyframe();
    expect(obj(id).gradientTracks?.fill?.map((k) => k.time)).toEqual([1]);
    expect(useEditor.getState().selectedGradientKeyframe).toBeNull();
  });

  it('setSelectedKeyframeEasing routes to the gradient track', () => {
    const id = seedRect();
    useEditor.getState().seek(0);
    useEditor.getState().setVectorGradient('fill', lin(0));
    useEditor.getState().selectGradientKeyframe({ objectId: id, property: 'fill', time: 0 });
    useEditor.getState().setSelectedKeyframeEasing('easeIn');
    expect(obj(id).gradientTracks!.fill![0].easing).toBe('easeIn');
  });

  it('removing the last gradient keyframe collapses the track to absent', () => {
    const id = seedRect();
    useEditor.getState().seek(0);
    useEditor.getState().setVectorGradient('fill', lin(0));
    useEditor.getState().selectGradientKeyframe({ objectId: id, property: 'fill', time: 0 });
    useEditor.getState().removeSelectedGradientKeyframe();
    expect(obj(id).gradientTracks).toBeUndefined();
  });

  it('re-keying an existing gradient keyframe preserves its easing (stop edits do not reset it)', () => {
    const id = seedRect();
    useEditor.getState().seek(0);
    useEditor.getState().setVectorGradient('fill', lin(0));
    useEditor.getState().selectGradientKeyframe({ objectId: id, property: 'fill', time: 0 });
    useEditor.getState().setSelectedKeyframeEasing('easeIn');
    // A subsequent stop/geometry edit at the same time must keep easeIn.
    useEditor.getState().setVectorGradient('fill', lin(0.5));
    expect(obj(id).gradientTracks!.fill![0].easing).toBe('easeIn');
  });
});

describe('stroke dash', () => {
  function seedRect(): string {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
    return useEditor.getState().selectedObjectId!;
  }
  const obj = (id: string) => useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  const asset = (id: string) => {
    const a = useEditor.getState().history.present.assets.find((x) => x.id === obj(id).assetId)!;
    if (a.kind !== 'vector') throw new Error('not vector');
    return a;
  };

  it('setStrokeDasharray sets the pattern; clearing it also clears the offset track', () => {
    const id = seedRect();
    useEditor.getState().setStrokeDasharray([1, 1]);
    expect(asset(id).style.strokeDasharray).toEqual([1, 1]);
    useEditor.getState().seek(0);
    useEditor.getState().setStrokeDashoffset(1); // an orphan-able offset track
    useEditor.getState().setStrokeDasharray(undefined);
    expect(asset(id).style.strokeDasharray).toBeUndefined();
    expect(obj(id).dashOffsetTrack).toBeUndefined(); // not left inflating duration
  });

  it('setStrokeDashoffset autoKey ON upserts a dash keyframe at the playhead', () => {
    const id = seedRect();
    useEditor.getState().seek(1);
    useEditor.getState().setStrokeDashoffset(0.5);
    expect(obj(id).dashOffsetTrack).toEqual([{ time: 1, value: 0.5, easing: 'linear' }]);
  });

  it('setStrokeDashoffset autoKey OFF writes the static offset', () => {
    const id = seedRect();
    useEditor.getState().toggleAutoKey();
    useEditor.getState().setStrokeDashoffset(0.25);
    expect(asset(id).style.strokeDashoffset).toBe(0.25);
    expect(obj(id).dashOffsetTrack).toBeUndefined();
  });

  it('drawOn seeds dasharray [1,1] + two keyframes 1->0 over [playhead, +1s]', () => {
    const id = seedRect();
    useEditor.getState().seek(0);
    useEditor.getState().drawOn();
    expect(asset(id).style.strokeDasharray).toEqual([1, 1]);
    const track = obj(id).dashOffsetTrack!;
    expect(track.map((k) => [k.time, k.value])).toEqual([
      [0, 1],
      [1, 0],
    ]);
  });

  it('removeSelectedDashKeyframe deletes it and collapses an emptied track', () => {
    const id = seedRect();
    useEditor.getState().seek(0);
    useEditor.getState().setStrokeDashoffset(1);
    useEditor.getState().selectDashKeyframe({ objectId: id, time: 0 });
    useEditor.getState().removeSelectedDashKeyframe();
    expect(obj(id).dashOffsetTrack).toBeUndefined();
    expect(useEditor.getState().selectedDashKeyframe).toBeNull();
  });

  it('setSelectedKeyframeEasing routes to the dash track', () => {
    const id = seedRect();
    useEditor.getState().seek(0);
    useEditor.getState().setStrokeDashoffset(1);
    useEditor.getState().selectDashKeyframe({ objectId: id, time: 0 });
    useEditor.getState().setSelectedKeyframeEasing('easeIn');
    expect(obj(id).dashOffsetTrack![0].easing).toBe('easeIn');
  });

  it('re-keying an existing dash keyframe preserves its easing', () => {
    const id = seedRect();
    useEditor.getState().seek(0);
    useEditor.getState().setStrokeDashoffset(1);
    useEditor.getState().selectDashKeyframe({ objectId: id, time: 0 });
    useEditor.getState().setSelectedKeyframeEasing('easeIn');
    useEditor.getState().setStrokeDashoffset(0.5); // edit offset at same time
    expect(obj(id).dashOffsetTrack![0].easing).toBe('easeIn');
  });

  it('selecting a gradient keyframe clears a stale dash selection (mutual exclusion)', () => {
    const id = seedRect();
    useEditor.getState().seek(0);
    useEditor.getState().setStrokeDashoffset(1);
    useEditor.getState().selectDashKeyframe({ objectId: id, time: 0 });
    useEditor.getState().selectGradientKeyframe({ objectId: id, property: 'fill', time: 0 });
    expect(useEditor.getState().selectedDashKeyframe).toBeNull();
  });
});

describe('selectColorKeyframe', () => {
  it('sets the selection and clears node/shape/scalar selections', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectColorKeyframe({ objectId: id, property: 'fill', time: 0 });
    const st = useEditor.getState();
    expect(st.selectedColorKeyframe).toEqual({ objectId: id, property: 'fill', time: 0 });
    expect(st.selectedKeyframe).toBeNull();
    expect(st.selectedShapeKeyframe).toBeNull();
    expect(st.selectedNodeIndex).toBeNull();
  });
});

describe('color keyframe easing + delete', () => {
  function seedColorKf() {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
    s.seek(1);
    s.setVectorColor('fill', '#ff0000');
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectColorKeyframe({ objectId: id, property: 'fill', time: 1 });
    return id;
  }
  it('setSelectedKeyframeEasing routes to the selected color keyframe', () => {
    seedColorKf();
    useEditor.getState().setSelectedKeyframeEasing('easeIn');
    expect(useEditor.getState().history.present.objects[0].colorTracks!.fill![0].easing).toBe('easeIn');
  });
  it('removeSelectedColorKeyframe deletes it and clears the selection', () => {
    seedColorKf();
    useEditor.getState().removeSelectedColorKeyframe();
    expect(useEditor.getState().history.present.objects[0].colorTracks?.fill ?? []).toHaveLength(0);
    expect(useEditor.getState().selectedColorKeyframe).toBeNull();
  });
});

describe('motion paths', () => {
  const guide: PathData = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }], closed: false };

  function selectedObjId(): string {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    return useEditor.getState().selectedObjectId!;
  }

  it('addMotionPath stores the guide with a seeded 0->1 progress track (one undo)', () => {
    const id = selectedObjId();
    const before = useEditor.getState().history.present;
    useEditor.getState().addMotionPath(id, guide);
    const obj = useEditor.getState().history.present.objects.find((o) => o.id === id)!;
    expect(obj.motionPath!.path).toEqual(guide);
    expect(obj.motionPath!.orient).toBe(false);
    expect(obj.motionPath!.progress.map((k) => k.value)).toEqual([0, 1]);
    useEditor.getState().undo();
    expect(useEditor.getState().history.present).toBe(before);
  });

  it('setMotionPathOrient toggles orient', () => {
    const id = selectedObjId();
    useEditor.getState().addMotionPath(id, guide);
    useEditor.getState().setMotionPathOrient(id, true);
    expect(useEditor.getState().history.present.objects.find((o) => o.id === id)!.motionPath!.orient).toBe(true);
  });

  it('removeMotionPath clears the field', () => {
    const id = selectedObjId();
    useEditor.getState().addMotionPath(id, guide);
    useEditor.getState().removeMotionPath(id);
    expect(useEditor.getState().history.present.objects.find((o) => o.id === id)!.motionPath).toBeUndefined();
  });

  it('setMotionProgress upserts a progress keyframe at the snapped playhead (autoKey on)', () => {
    const id = selectedObjId();
    useEditor.getState().addMotionPath(id, guide);
    useEditor.setState({ time: 1, autoKey: true });
    useEditor.getState().setMotionProgress(0.25);
    const prog = useEditor.getState().history.present.objects.find((o) => o.id === id)!.motionPath!.progress;
    expect(prog.find((k) => Math.abs(k.time - 1) < 1e-6)!.value).toBe(0.25);
  });

  it('selectProgressKeyframe clears other selections; removeSelectedProgressKeyframe deletes it', () => {
    const id = selectedObjId();
    useEditor.getState().addMotionPath(id, guide);
    useEditor.getState().selectProgressKeyframe({ objectId: id, time: 0 });
    expect(useEditor.getState().selectedKeyframe).toBeNull();
    expect(useEditor.getState().selectedColorKeyframe).toBeNull();
    useEditor.getState().removeSelectedProgressKeyframe();
    const prog = useEditor.getState().history.present.objects.find((o) => o.id === id)!.motionPath!.progress;
    expect(prog.some((k) => Math.abs(k.time - 0) < 1e-6)).toBe(false);
    expect(useEditor.getState().selectedProgressKeyframe).toBeNull();
  });

  it('setSelectedKeyframeEasing routes to the selected progress keyframe', () => {
    const id = selectedObjId();
    useEditor.getState().addMotionPath(id, guide);
    useEditor.getState().selectProgressKeyframe({ objectId: id, time: 0 });
    useEditor.getState().setSelectedKeyframeEasing('easeIn');
    const prog = useEditor.getState().history.present.objects.find((o) => o.id === id)!.motionPath!.progress;
    expect(prog.find((k) => Math.abs(k.time - 0) < 1e-6)!.easing).toBe('easeIn');
  });
});

describe('primitive tools', () => {
  it('supports the new tool modes', () => {
    useEditor.getState().setActiveTool('polygon');
    expect(useEditor.getState().activeTool).toBe('polygon');
    useEditor.getState().setActiveTool('star');
    expect(useEditor.getState().activeTool).toBe('star');
    useEditor.getState().setActiveTool('line');
    expect(useEditor.getState().activeTool).toBe('line');
  });

  it('has sensible tool-option defaults', () => {
    const s = useEditor.getState();
    expect(s.polygonSides).toBe(5);
    expect(s.starPoints).toBe(5);
    expect(s.starInnerRatio).toBe(0.5);
  });

  it('clamps tool-option setters', () => {
    const s = () => useEditor.getState();
    s().setPolygonSides(2);
    expect(s().polygonSides).toBe(3);
    s().setStarPoints(1);
    expect(s().starPoints).toBe(2);
    s().setStarInnerRatio(0);
    expect(s().starInnerRatio).toBeCloseTo(0.01, 6);
    s().setStarInnerRatio(5);
    expect(s().starInnerRatio).toBeCloseTo(0.99, 6);
    s().setStarInnerRatio(0.3);
    expect(s().starInnerRatio).toBeCloseTo(0.3, 6);
  });
});

describe('brush tool options + addVectorPath style seed', () => {
  it('clamps brush tool options', () => {
    const s = useEditor.getState();
    s.setBrushSize(-3);
    expect(useEditor.getState().brushSize).toBe(1);
    s.setBrushSmoothing(5);
    expect(useEditor.getState().brushSmoothing).toBe(1);
    s.setBrushSmoothing(-1);
    expect(useEditor.getState().brushSmoothing).toBe(0);
  });

  it('addVectorPath applies an optional style seed over the defaults', () => {
    const path: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }] };
    useEditor.getState().addVectorPath(path, { strokeWidth: 9, strokeLinecap: 'round' });
    const proj = useEditor.getState().history.present;
    const asset = proj.assets[proj.assets.length - 1];
    expect(asset.kind).toBe('vector');
    if (asset.kind === 'vector') {
      expect(asset.style.strokeWidth).toBe(9);
      expect(asset.style.strokeLinecap).toBe('round');
      expect(asset.style.fill).toBe('none'); // default preserved
    }
  });
});

describe('toggleObjectVisibility', () => {
  it('flips hidden (undoable)', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    expect(useEditor.getState().history.present.objects[0].hidden).toBeFalsy();
    useEditor.getState().toggleObjectVisibility(id);
    expect(useEditor.getState().history.present.objects[0].hidden).toBe(true);
    useEditor.getState().undo();
    expect(useEditor.getState().history.present.objects[0].hidden).toBeFalsy();
  });
  it('is a no-op for an unknown id', () => {
    const s = useEditor.getState();
    s.newProject();
    const past = useEditor.getState().history.past.length;
    useEditor.getState().toggleObjectVisibility('nope');
    expect(useEditor.getState().history.past.length).toBe(past);
  });
});

describe('reorderSelected', () => {
  it('sends the selected front object to the back (one undo step)', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 0
    s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 1 (selected, front)
    const front = useEditor.getState().selectedObjectId!;
    useEditor.getState().reorderSelected('back');
    const objsById = Object.fromEntries(
      useEditor.getState().history.present.objects.map((o) => [o.id, o.zOrder]),
    );
    expect(objsById[front]).toBe(0); // now at the back
    expect(useEditor.getState().selectedObjectId).toBe(front); // still selected

    useEditor.getState().undo();
    const after = useEditor.getState().history.present.objects.find((o) => o.id === front)!;
    expect(after.zOrder).toBe(1); // restored
  });

  it('is a no-op when nothing is selected or already at the extreme', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const past = useEditor.getState().history.past.length;
    useEditor.getState().reorderSelected('front'); // single object -> no-op
    expect(useEditor.getState().history.past.length).toBe(past); // no new history entry
    s.selectObject(null);
    useEditor.getState().reorderSelected('back'); // nothing selected -> no-op
    expect(useEditor.getState().history.past.length).toBe(past);
  });
});

describe('deleteSelectedObject', () => {
  it('removes a vector object + its asset, clears selection, one undo step', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 30, height: 20 });
    expect(useEditor.getState().history.present.objects).toHaveLength(1);
    expect(useEditor.getState().history.present.assets.filter((a) => a.kind === 'vector')).toHaveLength(1);

    useEditor.getState().deleteSelectedObject();
    expect(useEditor.getState().history.present.objects).toHaveLength(0);
    expect(useEditor.getState().history.present.assets.filter((a) => a.kind === 'vector')).toHaveLength(0);
    expect(useEditor.getState().selectedObjectId).toBeNull();

    useEditor.getState().undo(); // one undo restores both
    expect(useEditor.getState().history.present.objects).toHaveLength(1);
  });

  it('is a no-op when nothing is selected', () => {
    const s = useEditor.getState();
    s.newProject();
    s.selectObject(null);
    useEditor.getState().deleteSelectedObject();
    expect(useEditor.getState().history.present.objects).toHaveLength(0);
  });

  it('after deleting a middle object, a new object gets a unique top zOrder', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 0
    s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 1
    s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 2
    const mid = useEditor.getState().history.present.objects[1].id;
    useEditor.getState().selectObject(mid);
    useEditor.getState().deleteSelectedObject(); // survivors have zOrder 0 and 2 (gap)
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const objects = useEditor.getState().history.present.objects;
    const zs = objects.map((o) => o.zOrder);
    expect(new Set(zs).size).toBe(zs.length); // all unique (no collision)
    expect(Math.max(...zs)).toBe(zs[zs.length - 1]); // the newest is on top
    const names = objects.map((o) => o.name);
    expect(new Set(names).size).toBe(names.length); // names stay unique past the delete gap
  });
});

describe('duplicateSelected', () => {
  it('clones a vector object + its asset, selects the copy, one undo step', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 40, height: 30 });
    const before = useEditor.getState().history.present;
    expect(before.objects).toHaveLength(1);
    const origId = before.objects[0].id;

    useEditor.getState().duplicateSelected();
    const after = useEditor.getState().history.present;
    expect(after.objects).toHaveLength(2);
    expect(after.assets.filter((a) => a.kind === 'vector')).toHaveLength(2); // asset cloned
    const copy = after.objects.find((o) => o.id !== origId)!;
    expect(useEditor.getState().selectedObjectId).toBe(copy.id);
    expect(copy.zOrder).toBe(1); // placed on top
    expect([copy.base.x, copy.base.y]).toEqual([10, 10]); // offset

    useEditor.getState().undo(); // one undo removes both object + asset
    expect(useEditor.getState().history.present.objects).toHaveLength(1);
    // The selection pointed at the now-removed copy -> cleared (no dangling selection).
    expect(useEditor.getState().selectedObjectId).toBeNull();
  });

  it('is a no-op when nothing is selected', () => {
    const s = useEditor.getState();
    s.newProject();
    s.selectObject(null);
    useEditor.getState().duplicateSelected();
    expect(useEditor.getState().history.present.objects).toHaveLength(0);
  });
});

describe('onion skin toggle', () => {
  it('defaults off and flips', () => {
    useEditor.getState().newProject();
    expect(useEditor.getState().onionSkin).toBe(false);
    useEditor.getState().toggleOnionSkin();
    expect(useEditor.getState().onionSkin).toBe(true);
    useEditor.getState().toggleOnionSkin();
    expect(useEditor.getState().onionSkin).toBe(false);
  });
  it('persists across newProject (a view preference, like theme)', () => {
    useEditor.getState().toggleOnionSkin();
    expect(useEditor.getState().onionSkin).toBe(true);
    useEditor.getState().newProject();
    expect(useEditor.getState().onionSkin).toBe(true);
  });
});

describe('renameObject', () => {
  it('renames an object (undoable)', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().renameObject(id, 'Hero');
    expect(useEditor.getState().history.present.objects[0].name).toBe('Hero');
    useEditor.getState().undo();
    expect(useEditor.getState().history.present.objects[0].name).not.toBe('Hero');
  });
  it('is a no-op for an unknown id or an unchanged name', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    const name = useEditor.getState().history.present.objects[0].name;
    const past = useEditor.getState().history.past.length;
    useEditor.getState().renameObject('nope', 'X');
    useEditor.getState().renameObject(id, name); // unchanged
    expect(useEditor.getState().history.past.length).toBe(past); // no new history entry
  });
});

describe('toggleObjectLock', () => {
  it('locks/unlocks an object (undoable)', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().toggleObjectLock(id);
    expect(useEditor.getState().history.present.objects[0].locked).toBe(true);
    useEditor.getState().undo();
    expect(useEditor.getState().history.present.objects[0].locked).toBeFalsy();
  });
  it('is a no-op for an unknown id', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const past = useEditor.getState().history.past.length;
    useEditor.getState().toggleObjectLock('nope');
    expect(useEditor.getState().history.past.length).toBe(past);
  });
  it('locking the SELECTED object deselects it', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().toggleObjectLock(id);
    expect(useEditor.getState().selectedObjectId).toBeNull();
  });
  it('locking a NON-selected object leaves the selection intact', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // obj A
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 20, y: 20, width: 10, height: 10 }); // obj B (now selected)
    const b = useEditor.getState().selectedObjectId!;
    useEditor.getState().toggleObjectLock(a); // lock the non-selected A
    expect(useEditor.getState().selectedObjectId).toBe(b);
  });
  it('unlocking does not change selection', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().toggleObjectLock(id); // lock + deselect
    useEditor.getState().addVectorShape('rect', { x: 20, y: 20, width: 10, height: 10 }); // select B
    const b = useEditor.getState().selectedObjectId!;
    useEditor.getState().toggleObjectLock(id); // unlock A while B selected
    expect(useEditor.getState().selectedObjectId).toBe(b);
  });
  it('a locked object cannot be edited or deleted even if it becomes selected (e.g. via a timeline keyframe)', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().toggleObjectLock(id); // lock + deselect
    useEditor.getState().selectObject(id); // simulate selection re-established out-of-band
    const before = useEditor.getState().history.present.objects[0];
    useEditor.getState().setProperty('x', 999); // blocked
    useEditor.getState().deleteSelectedObject(); // blocked
    const after = useEditor.getState().history.present.objects;
    expect(after).toHaveLength(1);
    expect(after[0]).toBe(before); // unchanged reference -> no edit committed
  });
});

describe('moveObjectToTarget (store)', () => {
  it('reorders so the dragged object becomes front-most and commits one step', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // A: z0 (back)
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 20, y: 20, width: 10, height: 10 }); // B: z1 (front)
    const b = useEditor.getState().selectedObjectId!;
    const past = useEditor.getState().history.past.length;
    useEditor.getState().moveObjectToTarget(a, b); // drag A up onto B -> A front
    const objs = useEditor.getState().history.present.objects;
    const za = objs.find((o) => o.id === a)!.zOrder;
    const zb = objs.find((o) => o.id === b)!.zOrder;
    expect(za).toBeGreaterThan(zb); // A now in front of B
    expect(useEditor.getState().history.past.length).toBe(past + 1); // exactly one commit
    expect(useEditor.getState().selectedObjectId).toBe(b); // selection unchanged
  });
  it('is a no-op (no commit) for the same id', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 20, y: 20, width: 10, height: 10 });
    const past = useEditor.getState().history.past.length;
    useEditor.getState().moveObjectToTarget(a, a);
    expect(useEditor.getState().history.past.length).toBe(past);
  });
});

describe('clipboard (copy/cut/paste)', () => {
  // The clipboard intentionally survives newProject (cross-project paste), so reset it
  // per-test for isolation — the global beforeEach (newProject) deliberately preserves it.
  beforeEach(() => useEditor.setState({ clipboard: null }));
  it('copySelected snapshots the selected object; paste adds an offset copy (one undo step)', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    const src = useEditor.getState().history.present.objects[0];
    useEditor.getState().copySelected();
    expect(useEditor.getState().clipboard?.[0].object.id).toBe(id);
    const past = useEditor.getState().history.past.length;
    useEditor.getState().paste();
    const objs = useEditor.getState().history.present.objects;
    expect(objs).toHaveLength(2);
    const copy = objs.find((o) => o.id !== id)!;
    expect(copy.id).not.toBe(id); // fresh id
    expect(copy.base.x).toBe(src.base.x + 10); // DUP_OFFSET
    expect(copy.name).toBe(`${src.name} copy`);
    expect(useEditor.getState().selectedObjectId).toBe(copy.id); // copy selected
    expect(useEditor.getState().history.past.length).toBe(past + 1); // one commit
  });
  it('paste clones a vector object onto an independent asset', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const srcAssetId = useEditor.getState().history.present.objects[0].assetId;
    useEditor.getState().copySelected();
    useEditor.getState().paste();
    const copy = useEditor.getState().history.present.objects.at(-1)!;
    expect(copy.assetId).not.toBe(srcAssetId); // independent cloned asset
    expect(useEditor.getState().history.present.assets.some((a) => a.id === copy.assetId)).toBe(true);
  });
  it('copySelected is a no-op with nothing selected; paste is a no-op with an empty clipboard', () => {
    useEditor.getState().selectObject(null);
    useEditor.getState().copySelected();
    expect(useEditor.getState().clipboard).toBeNull();
    const past = useEditor.getState().history.past.length;
    useEditor.getState().paste();
    expect(useEditor.getState().history.past.length).toBe(past); // no commit
  });
  it('the clipboard snapshot is frozen — editing the source after copy does not change the paste', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    useEditor.getState().copySelected();
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('x', 500); // add an x keyframe to the source AFTER copying
    useEditor.getState().paste();
    const copy = useEditor.getState().history.present.objects.at(-1)!;
    expect(copy.base.x).toBe(0 + 10); // base from the frozen snapshot (x=0), NOT mutated
    expect(copy.tracks.x).toBeUndefined(); // the post-copy x track did NOT leak into the snapshot
  });
  it('cut copies then deletes the selected object', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().cut();
    expect(useEditor.getState().clipboard?.[0].object.id).toBe(id);
    expect(useEditor.getState().history.present.objects).toHaveLength(0); // removed
  });
  it('cut of a locked object copies it but does not remove it', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().toggleObjectLock(id); // locks + deselects
    useEditor.getState().selectObject(id); // re-select (out-of-band, like the Slice-19 residual)
    useEditor.getState().cut();
    expect(useEditor.getState().clipboard?.[0].object.id).toBe(id);
    expect(useEditor.getState().history.present.objects).toHaveLength(1); // NOT deleted (locked)
  });
  it('pasting a locked clipboard object adds the copy but does not select it (Slice-19 invariant)', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().toggleObjectLock(id); // locks + deselects
    useEditor.getState().selectObject(id); // re-select out-of-band so copy can capture it
    useEditor.getState().copySelected();
    useEditor.getState().paste();
    const objs = useEditor.getState().history.present.objects;
    expect(objs).toHaveLength(2);
    expect(objs.at(-1)!.locked).toBe(true); // faithful clone
    expect(useEditor.getState().selectedObjectId).toBeNull(); // a locked clone is NOT selected
  });
  it('cross-project paste re-adds a missing imported-svg asset', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';
    useEditor.getState().addAsset({ id: 'svg1', kind: 'svg', name: 'box', normalizedContent: svg, viewBox: '0 0 10 10', width: 10, height: 10 });
    useEditor.getState().addObject('svg1');
    useEditor.getState().copySelected();
    useEditor.getState().newProject(); // clipboard survives; project (and its assets) reset
    useEditor.getState().paste();
    const copy = useEditor.getState().history.present.objects.at(-1)!;
    expect(useEditor.getState().history.present.assets.some((a) => a.id === copy.assetId)).toBe(true);
  });

  it('copySelected snapshots ALL selected; paste adds offset copies of all (one commit)', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
    const b = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().copySelected();
    expect(useEditor.getState().clipboard).toHaveLength(2);
    const past = useEditor.getState().history.past.length;
    useEditor.getState().paste();
    expect(useEditor.getState().history.present.objects).toHaveLength(4);
    expect(useEditor.getState().selectedObjectIds).toHaveLength(2); // the two clones
    expect(useEditor.getState().selectedObjectIds).not.toContain(a);
    expect(useEditor.getState().selectedObjectIds).not.toContain(b);
    expect(useEditor.getState().history.past.length).toBe(past + 1); // one commit
    // zOrder-stable: the clone of the lower-zOrder original (a) stacks below b's clone.
    const objs = useEditor.getState().history.present.objects;
    const cloneA = objs.find((o) => o.base.x === 10)!; // a (x=0) + DUP_OFFSET
    const cloneB = objs.find((o) => o.base.x === 50)!; // b (x=40) + DUP_OFFSET
    expect(cloneA.zOrder).toBeLessThan(cloneB.zOrder);
  });

  it('cut removes ALL selected and the clipboard holds them; paste restores them', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
    const b = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().cut();
    expect(useEditor.getState().history.present.objects).toHaveLength(0);
    expect(useEditor.getState().clipboard).toHaveLength(2);
    useEditor.getState().paste();
    expect(useEditor.getState().history.present.objects).toHaveLength(2);
  });
});

describe('copy/paste keyframes', () => {
  beforeEach(() => useEditor.setState({ keyframeClipboard: null, clipboard: null }));

  it('round-trips a scalar rotation keyframe (value + easing) to the playhead', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('rotation', 45); // a rotation keyframe at t=0
    useEditor.getState().selectKeyframe({ objectId: id, property: 'rotation', time: 0 });
    useEditor.getState().setSelectedKeyframeEasing('easeIn'); // give it a non-linear easing
    useEditor.getState().copyKeyframe();
    expect(useEditor.getState().keyframeClipboard?.kind).toBe('scalar');
    const past = useEditor.getState().history.past.length;
    useEditor.getState().seek(1);
    useEditor.getState().pasteKeyframe();
    const track = useEditor.getState().history.present.objects[0].tracks.rotation!;
    expect(track).toHaveLength(2);
    const pasted = track.find((k) => Math.abs(k.time - 1) < 1e-6)!;
    expect(pasted.value).toBe(45);
    expect(pasted.easing).toBe('easeIn');
    expect(useEditor.getState().history.past.length).toBe(past + 1); // one commit
    expect(useEditor.getState().selectedKeyframe).toEqual({ objectId: id, property: 'rotation', time: 1 });
  });

  it('round-trips a color keyframe (hex value preserved)', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(0);
    useEditor.getState().setVectorColor('fill', '#abcdef');
    useEditor.getState().selectColorKeyframe({ objectId: id, property: 'fill', time: 0 });
    useEditor.getState().copyKeyframe();
    expect(useEditor.getState().keyframeClipboard?.kind).toBe('color');
    useEditor.getState().seek(1);
    useEditor.getState().pasteKeyframe();
    const track = useEditor.getState().history.present.objects[0].colorTracks!.fill!;
    expect(track.find((k) => Math.abs(k.time - 1) < 1e-6)!.value).toBe('#abcdef');
  });

  it('round-trips a shape keyframe (path preserved)', () => {
    useEditor.getState().addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().addShapeKeyframe(); // a shape keyframe at the playhead
    useEditor.getState().seek(0);
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
    const sourceKf = useEditor.getState().history.present.objects[0].shapeTrack!.find((k) => Math.abs(k.time - 0) < 1e-6)!;
    useEditor.getState().copyKeyframe();
    expect(useEditor.getState().keyframeClipboard?.kind).toBe('shape');
    useEditor.getState().seek(1);
    useEditor.getState().pasteKeyframe();
    const track = useEditor.getState().history.present.objects[0].shapeTrack!;
    const pasted = track.find((k) => Math.abs(k.time - 1) < 1e-6)!;
    expect(pasted.path).toEqual(sourceKf.path); // path preserved
    expect(pasted.easing).toBe(sourceKf.easing);
  });

  it('copyKeyframe clears the object clipboard and vice versa (mutual exclusion)', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().copySelected(); // object clipboard set
    expect(useEditor.getState().clipboard).not.toBeNull();
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('x', 5);
    useEditor.getState().selectKeyframe({ objectId: id, property: 'x', time: 0 });
    useEditor.getState().copyKeyframe();
    expect(useEditor.getState().clipboard).toBeNull(); // object clipboard cleared
    expect(useEditor.getState().keyframeClipboard).not.toBeNull();
    useEditor.getState().copySelected();
    expect(useEditor.getState().keyframeClipboard).toBeNull(); // keyframe clipboard cleared
  });

  it('pasteKeyframe is a no-op with an empty clipboard', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const past = useEditor.getState().history.past.length;
    useEditor.getState().pasteKeyframe();
    expect(useEditor.getState().history.past.length).toBe(past);
  });

  it('pasteKeyframe is a no-op after the source object was deleted', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('x', 5);
    useEditor.getState().selectKeyframe({ objectId: id, property: 'x', time: 0 });
    useEditor.getState().copyKeyframe();
    useEditor.getState().selectObject(id);
    useEditor.getState().deleteSelectedObject();
    const past = useEditor.getState().history.past.length;
    useEditor.getState().seek(1);
    useEditor.getState().pasteKeyframe();
    expect(useEditor.getState().history.past.length).toBe(past); // no commit (object gone)
  });

  it('copyKeyframe with a stale/unresolvable keyframe selected still clears the object clipboard', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().copySelected(); // object clipboard set
    expect(useEditor.getState().clipboard).not.toBeNull();
    // Select a keyframe that does not exist (no keyframe was ever created at t=2).
    useEditor.getState().selectKeyframe({ objectId: id, property: 'x', time: 2 });
    useEditor.getState().copyKeyframe();
    expect(useEditor.getState().clipboard).toBeNull(); // object clipboard cleared anyway
    expect(useEditor.getState().keyframeClipboard).toBeNull(); // nothing resolvable -> empty
  });
});

describe('retimeSelectedKeyframe', () => {
  it('moves a scalar keyframe to a new time (value + easing preserved, re-selected)', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('rotation', 45);
    useEditor.getState().selectKeyframe({ objectId: id, property: 'rotation', time: 0 });
    useEditor.getState().setSelectedKeyframeEasing('easeIn');
    useEditor.getState().retimeSelectedKeyframe(1);
    const track = useEditor.getState().history.present.objects[0].tracks.rotation!;
    expect(track.some((k) => Math.abs(k.time - 0) < 1e-6)).toBe(false); // old time gone
    const moved = track.find((k) => Math.abs(k.time - 1) < 1e-6)!;
    expect(moved.value).toBe(45);
    expect(moved.easing).toBe('easeIn');
    expect(useEditor.getState().selectedKeyframe).toEqual({ objectId: id, property: 'rotation', time: 1 });
  });

  it('moves a color keyframe (hex preserved)', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(0);
    useEditor.getState().setVectorColor('fill', '#abcdef');
    useEditor.getState().selectColorKeyframe({ objectId: id, property: 'fill', time: 0 });
    useEditor.getState().retimeSelectedKeyframe(2);
    const track = useEditor.getState().history.present.objects[0].colorTracks!.fill!;
    expect(track.find((k) => Math.abs(k.time - 2) < 1e-6)!.value).toBe('#abcdef');
    expect(track.some((k) => Math.abs(k.time - 0) < 1e-6)).toBe(false);
  });

  it('moves a shape keyframe (path preserved)', () => {
    useEditor.getState().addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().addShapeKeyframe();
    useEditor.getState().seek(0);
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
    const src = useEditor.getState().history.present.objects[0].shapeTrack!.find((k) => Math.abs(k.time) < 1e-6)!;
    useEditor.getState().retimeSelectedKeyframe(1);
    const track = useEditor.getState().history.present.objects[0].shapeTrack!;
    expect(track.find((k) => Math.abs(k.time - 1) < 1e-6)!.path).toEqual(src.path);
    expect(track.some((k) => Math.abs(k.time) < 1e-6)).toBe(false);
  });

  it('clamps a negative target to 0', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(1);
    useEditor.getState().setProperty('x', 5);
    useEditor.getState().selectKeyframe({ objectId: id, property: 'x', time: 1 });
    useEditor.getState().retimeSelectedKeyframe(-3);
    const track = useEditor.getState().history.present.objects[0].tracks.x!;
    expect(track.some((k) => Math.abs(k.time - 0) < 1e-6)).toBe(true); // clamped to 0
    expect(track.some((k) => Math.abs(k.time - 1) < 1e-6)).toBe(false); // moved, not duplicated
  });

  it('moves a gradient keyframe (covers upsertGradientKeyframe)', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(0);
    useEditor.getState().setVectorGradient('fill', {
      type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5,
      stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
    });
    useEditor.getState().selectGradientKeyframe({ objectId: id, property: 'fill', time: 0 });
    useEditor.getState().retimeSelectedKeyframe(2);
    const track = useEditor.getState().history.present.objects[0].gradientTracks!.fill!;
    expect(track.some((k) => Math.abs(k.time - 2) < 1e-6)).toBe(true);
    expect(track.some((k) => Math.abs(k.time - 0) < 1e-6)).toBe(false);
  });

  it('is a no-op (no history entry) when the target equals the current time', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(1);
    useEditor.getState().setProperty('x', 5);
    useEditor.getState().selectKeyframe({ objectId: id, property: 'x', time: 1 });
    const past = useEditor.getState().history.past.length;
    useEditor.getState().retimeSelectedKeyframe(1);
    expect(useEditor.getState().history.past.length).toBe(past);
  });
});

describe('deleteSelectedKeyframe / cutKeyframe', () => {
  beforeEach(() => useEditor.setState({ keyframeClipboard: null, clipboard: null }));

  it('deleteSelectedKeyframe removes the selected SCALAR keyframe (no-op if none)', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('rotation', 30);
    useEditor.getState().selectKeyframe({ objectId: id, property: 'rotation', time: 0 });
    useEditor.getState().deleteSelectedKeyframe();
    expect(useEditor.getState().history.present.objects[0].tracks.rotation ?? []).toHaveLength(0);
    const past = useEditor.getState().history.past.length;
    useEditor.getState().deleteSelectedKeyframe(); // nothing selected -> no-op
    expect(useEditor.getState().history.past.length).toBe(past);
  });

  it('deleteSelectedKeyframe removes a selected COLOR keyframe', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(0);
    useEditor.getState().setVectorColor('fill', '#abcdef');
    useEditor.getState().selectColorKeyframe({ objectId: id, property: 'fill', time: 0 });
    useEditor.getState().deleteSelectedKeyframe();
    expect(useEditor.getState().history.present.objects[0].colorTracks?.fill ?? []).toHaveLength(0);
  });

  it('deleteSelectedKeyframe removes a selected SHAPE keyframe', () => {
    useEditor.getState().addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
    const id = useEditor.getState().selectedObjectId!;
    // Two keyframes so removing one leaves a non-empty track — a no-op regression
    // would leave length 2 and still contain time:0, failing both assertions below.
    useEditor.getState().seek(0);
    useEditor.getState().addShapeKeyframe();
    useEditor.getState().seek(1);
    useEditor.getState().addShapeKeyframe();
    useEditor.getState().seek(0);
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
    useEditor.getState().deleteSelectedKeyframe();
    const track = useEditor.getState().history.present.objects[0].shapeTrack ?? [];
    expect(track).toHaveLength(1);
    expect(track).not.toContainEqual(expect.objectContaining({ time: 0 }));
  });

  it('cutKeyframe snapshots into the clipboard then removes; paste re-inserts at a new time', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('rotation', 45);
    useEditor.getState().selectKeyframe({ objectId: id, property: 'rotation', time: 0 });
    useEditor.getState().cutKeyframe();
    expect(useEditor.getState().keyframeClipboard?.kind).toBe('scalar'); // snapshotted
    expect(useEditor.getState().history.present.objects[0].tracks.rotation ?? []).toHaveLength(0); // removed
    useEditor.getState().seek(1);
    useEditor.getState().pasteKeyframe();
    const track = useEditor.getState().history.present.objects[0].tracks.rotation!;
    expect(track.find((k) => Math.abs(k.time - 1) < 1e-6)!.value).toBe(45); // round-trips
  });
});

describe('parametric primitives (slice 35)', () => {
  const vec = (a: Asset) => a as Extract<Asset, { kind: 'vector' }>;

  it('addPrimitive creates a path object whose asset carries a primitive spec', () => {
    useEditor.getState().newProject();
    useEditor.getState().addPrimitive({ kind: 'polygon', cx: 100, cy: 100, radius: 40, rotation: 0, sides: 6, cornerRadius: 0 });
    const obj = useEditor.getState().history.present.objects.at(-1)!;
    const asset = vec(useEditor.getState().history.present.assets.find((a) => a.id === obj.assetId)!);
    expect(asset.kind).toBe('vector');
    expect(asset.primitive?.kind).toBe('polygon');
    expect(asset.primitive?.sides).toBe(6);
    expect(asset.path?.nodes).toHaveLength(6);
  });

  it('setPrimitiveParam regenerates the path (more sides), keeps it parametric and centred', () => {
    useEditor.getState().newProject();
    useEditor.getState().addPrimitive({ kind: 'polygon', cx: 100, cy: 100, radius: 40, rotation: 0, sides: 5, cornerRadius: 0 });
    useEditor.getState().setPrimitiveParam('sides', 8);
    const obj = useEditor.getState().history.present.objects.at(-1)!;
    const asset = vec(useEditor.getState().history.present.assets.find((a) => a.id === obj.assetId)!);
    expect(asset.primitive?.sides).toBe(8);
    expect(asset.path?.nodes).toHaveLength(8);
    // Centre stays put: base + (localCx,localCy) == the original stage centre (100,100).
    expect(obj.base.x + asset.primitive!.cx).toBeCloseTo(100);
    expect(obj.base.y + asset.primitive!.cy).toBeCloseTo(100);
  });

  it('setPrimitiveParam ignores a param that does not match the kind (no stale field)', () => {
    useEditor.getState().newProject();
    useEditor.getState().addPrimitive({ kind: 'star', cx: 100, cy: 100, radius: 40, rotation: 0, points: 5, innerRatio: 0.5, cornerRadius: 0 });
    useEditor.getState().setPrimitiveParam('sides', 7); // 'sides' is a polygon param -> ignored
    const obj = useEditor.getState().history.present.objects.at(-1)!;
    const asset = vec(useEditor.getState().history.present.assets.find((a) => a.id === obj.assetId)!);
    expect(asset.primitive?.sides).toBeUndefined();
    expect(asset.primitive?.points).toBe(5);
  });

  it('setPrimitiveParam cornerRadius > 0 adds handles', () => {
    useEditor.getState().newProject();
    useEditor.getState().addPrimitive({ kind: 'star', cx: 100, cy: 100, radius: 40, rotation: 0, points: 5, innerRatio: 0.5, cornerRadius: 0 });
    useEditor.getState().setPrimitiveParam('cornerRadius', 6);
    const obj = useEditor.getState().history.present.objects.at(-1)!;
    const asset = vec(useEditor.getState().history.present.assets.find((a) => a.id === obj.assetId)!);
    expect(asset.path?.nodes.some((n) => n.in || n.out)).toBe(true);
  });

  it('node-editing detaches the primitive spec; setPrimitiveParam then no-ops', () => {
    useEditor.getState().newProject();
    useEditor.getState().addPrimitive({ kind: 'star', cx: 100, cy: 100, radius: 40, rotation: 0, points: 5, innerRatio: 0.5, cornerRadius: 0 });
    const id0 = useEditor.getState().history.present.assets.at(-1)!.id;
    const before = vec(useEditor.getState().history.present.assets.find((a) => a.id === id0)!);
    // a node move on the static path detaches the spec
    useEditor.getState().setPathData(
      { ...before.path!, nodes: before.path!.nodes.map((n, i) => (i === 0 ? { anchor: { x: n.anchor.x + 5, y: n.anchor.y } } : n)) },
      undefined,
    );
    const after = vec(useEditor.getState().history.present.assets.find((a) => a.id === id0)!);
    expect(after.primitive).toBeUndefined();
    const len = after.path!.nodes.length;
    useEditor.getState().setPrimitiveParam('points', 9); // no spec -> no-op
    const after2 = vec(useEditor.getState().history.present.assets.find((a) => a.id === id0)!);
    expect(after2.path!.nodes.length).toBe(len);
  });

  it('setPrimitiveParam is a no-op for a non-parametric path object', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 10 } }], closed: true });
    const obj = useEditor.getState().history.present.objects.at(-1)!;
    const asset = vec(useEditor.getState().history.present.assets.find((a) => a.id === obj.assetId)!);
    expect(asset.primitive).toBeUndefined();
    const len = asset.path!.nodes.length;
    useEditor.getState().setPrimitiveParam('sides', 7);
    const after = vec(useEditor.getState().history.present.assets.find((a) => a.id === obj.assetId)!);
    expect(after.path!.nodes.length).toBe(len);
  });
});

describe('multi-select (slice 36)', () => {
  function twoRects() {
    useEditor.getState().newProject();
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
    const b = useEditor.getState().selectedObjectId!;
    return { a, b };
  }

  it('toggleObjectSelection adds then removes; primary tracks the last', () => {
    const { a, b } = twoRects();
    useEditor.getState().selectObject(a);
    expect(useEditor.getState().selectedObjectIds).toEqual([a]);
    useEditor.getState().toggleObjectSelection(b);
    expect(useEditor.getState().selectedObjectIds).toEqual([a, b]);
    expect(useEditor.getState().selectedObjectId).toBe(b); // primary = last
    useEditor.getState().toggleObjectSelection(b);
    expect(useEditor.getState().selectedObjectIds).toEqual([a]);
    expect(useEditor.getState().selectedObjectId).toBe(a);
  });

  it('selectObject collapses to a single selection', () => {
    const { a, b } = twoRects();
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().selectObject(a);
    expect(useEditor.getState().selectedObjectIds).toEqual([a]);
    expect(useEditor.getState().selectedObjectId).toBe(a);
  });

  it('deleteSelectedObject removes ALL selected and clears the selection', () => {
    const { a, b } = twoRects();
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().deleteSelectedObject();
    expect(useEditor.getState().history.present.objects).toHaveLength(0);
    expect(useEditor.getState().selectedObjectIds).toEqual([]);
    expect(useEditor.getState().selectedObjectId).toBeNull();
  });

  it('duplicateSelected clones ALL selected and selects the clones', () => {
    const { a, b } = twoRects();
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().duplicateSelected();
    expect(useEditor.getState().history.present.objects).toHaveLength(4);
    expect(useEditor.getState().selectedObjectIds).toHaveLength(2);
    expect(useEditor.getState().selectedObjectIds).not.toContain(a);
    expect(useEditor.getState().selectedObjectIds).not.toContain(b);
  });

  it('clearStaleSelection prunes ids absent after undo and resyncs the primary', () => {
    const { a, b } = twoRects();
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().undo(); // undoes the 2nd add -> b no longer exists
    expect(useEditor.getState().history.present.objects).toHaveLength(1);
    expect(useEditor.getState().selectedObjectIds).toEqual([a]); // b pruned
    expect(useEditor.getState().selectedObjectId).toBe(a);
  });

  it('selecting a keyframe collapses a multi-selection to that one object (invariant)', () => {
    const { a, b } = twoRects();
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().selectKeyframe({ objectId: a, property: 'rotation', time: 0 });
    expect(useEditor.getState().selectedObjectIds).toEqual([a]);
    expect(useEditor.getState().selectedObjectId).toBe(a); // primary == last
  });

  it('locking a non-primary selected object drops it from the selection', () => {
    const { a, b } = twoRects();
    useEditor.getState().selectObjects([a, b]); // primary = b
    useEditor.getState().toggleObjectLock(a);
    expect(useEditor.getState().selectedObjectIds).toEqual([b]);
    expect(useEditor.getState().selectedObjectId).toBe(b);
  });

  it('cut removes the WHOLE multi-selection and copies them all (slice 39: bulk, no collapse)', () => {
    const { a, b } = twoRects();
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().cut();
    expect(useEditor.getState().history.present.objects).toHaveLength(0); // both cut
    expect(useEditor.getState().clipboard).toHaveLength(2); // both on the clipboard
  });
});

describe('multi-move (slice 37)', () => {
  function twoRects() {
    useEditor.getState().newProject();
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 40, y: 40, width: 10, height: 10 });
    const b = useEditor.getState().selectedObjectId!;
    return { a, b };
  }
  const xy = (id: string) => {
    const o = useEditor.getState().history.present.objects.find((p) => p.id === id)!;
    const s = sampleObject(o, 0);
    return { x: s.x, y: s.y };
  };

  it('nudgeSelected moves ALL selected by the delta in one commit', () => {
    const { a, b } = twoRects();
    const a0 = xy(a);
    const b0 = xy(b);
    useEditor.getState().selectObjects([a, b]);
    const pastBefore = useEditor.getState().history.past.length;
    useEditor.getState().nudgeSelected(5, -3);
    expect(xy(a)).toEqual({ x: a0.x + 5, y: a0.y - 3 });
    expect(xy(b)).toEqual({ x: b0.x + 5, y: b0.y - 3 });
    expect(useEditor.getState().history.past.length).toBe(pastBefore + 1); // one undo step
    useEditor.getState().undo();
    expect(xy(a)).toEqual(a0);
    expect(xy(b)).toEqual(b0);
  });

  it('nudgeSelected skips a locked member', () => {
    const { a, b } = twoRects();
    const b0 = xy(b);
    useEditor.getState().toggleObjectLock(b);
    useEditor.getState().selectObjects([a, b]);
    const a0 = xy(a);
    useEditor.getState().nudgeSelected(7, 0);
    expect(xy(a)).toEqual({ x: a0.x + 7, y: a0.y });
    expect(xy(b)).toEqual(b0); // locked b did not move
  });

  it('single selection nudge is unchanged (one object)', () => {
    const { a } = twoRects();
    const a0 = xy(a);
    useEditor.getState().selectObject(a);
    useEditor.getState().nudgeSelected(2, 2);
    expect(xy(a)).toEqual({ x: a0.x + 2, y: a0.y + 2 });
  });

  it('setObjectsTransforms writes x/y/scaleX/scaleY for several objects in one commit (slice 40)', () => {
    const { a, b } = twoRects();
    const past = useEditor.getState().history.past.length;
    useEditor.getState().setObjectsTransforms([
      { id: a, x: 5, y: 6, scaleX: 2, scaleY: 2 },
      { id: b, x: 80, y: 0, scaleX: 2, scaleY: 2 },
    ]);
    const sa = sampleObject(useEditor.getState().history.present.objects.find((o) => o.id === a)!, 0);
    expect({ x: sa.x, y: sa.y, sx: sa.scaleX, sy: sa.scaleY }).toEqual({ x: 5, y: 6, sx: 2, sy: 2 });
    expect(useEditor.getState().history.past.length).toBe(past + 1); // one commit
  });

  it('setObjectsTransforms skips a locked object', () => {
    const { a } = twoRects();
    useEditor.getState().toggleObjectLock(a);
    useEditor.getState().setObjectsTransforms([{ id: a, x: 99, y: 99, scaleX: 3, scaleY: 3 }]);
    const sa = sampleObject(useEditor.getState().history.present.objects.find((o) => o.id === a)!, 0);
    expect(sa.x).not.toBe(99); // locked -> unchanged
  });

  it('setObjectsTransforms upserts x/y/rotation only (scale untouched) in one commit (slice 41)', () => {
    const { a } = twoRects();
    const past = useEditor.getState().history.past.length;
    useEditor.getState().setObjectsTransforms([{ id: a, x: 7, y: 8, rotation: 90 }]);
    const sa = sampleObject(useEditor.getState().history.present.objects.find((o) => o.id === a)!, 0);
    expect({ x: sa.x, y: sa.y, rot: sa.rotation }).toEqual({ x: 7, y: 8, rot: 90 });
    expect(sa.scaleX).toBe(1); // scale not written
    expect(useEditor.getState().history.past.length).toBe(past + 1);
  });
});

describe('group containers (slice 45b)', () => {
  function threeRects() {
    useEditor.getState().newProject();
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
    const b = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 80, y: 0, width: 10, height: 10 });
    const c = useEditor.getState().selectedObjectId!;
    return { a, b, c };
  }
  const obj = (id: string) => useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  const groupId = () => useEditor.getState().history.present.objects.find((o) => o.isGroup)?.id;

  it('groupSelected creates a group container; children get parentId; group is selected; one commit; <2 no-op', () => {
    const { a, b, c } = threeRects();
    const past = useEditor.getState().history.past.length;
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().groupSelected();
    const gid = groupId()!;
    expect(gid).toBeTruthy();
    const group = obj(gid);
    expect(group.isGroup).toBe(true);
    expect(group.base).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }); // identity
    expect(obj(a).parentId).toBe(gid);
    expect(obj(b).parentId).toBe(gid);
    expect(obj(c).parentId).toBeUndefined();
    expect(useEditor.getState().selectedObjectIds).toEqual([gid]); // the group is selected
    expect(useEditor.getState().history.past.length).toBe(past + 1); // one undo step
    // <2 selected -> no-op
    useEditor.getState().selectObjects([c]);
    const p2 = useEditor.getState().history.past.length;
    useEditor.getState().groupSelected();
    expect(useEditor.getState().history.past.length).toBe(p2);
  });

  it('groupSelected anchors the group at the selection bbox centre', () => {
    const { a, b } = threeRects();
    useEditor.getState().selectObjects([a, b]); // a [0..10], b [40..50] -> bbox [0..50] -> centre x 25
    useEditor.getState().groupSelected();
    const group = obj(groupId()!);
    expect(group.anchorX).toBe(25);
    expect(group.anchorY).toBe(5);
  });

  it('selectObjectOrGroup on a member selects the GROUP, not the member', () => {
    const { a, b, c } = threeRects();
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().groupSelected();
    const gid = groupId()!;
    useEditor.getState().selectObject(c);
    useEditor.getState().selectObjectOrGroup(a);
    expect(useEditor.getState().selectedObjectIds).toEqual([gid]);
  });

  it('selectObjectOrGroup on an ungrouped object selects just it', () => {
    const { c } = threeRects();
    useEditor.getState().selectObjectOrGroup(c);
    expect(useEditor.getState().selectedObjectIds).toEqual([c]);
  });

  it('selectObjectsExpandingGroups maps a member hit to its group entity', () => {
    const { a, b, c } = threeRects();
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().groupSelected();
    const gid = groupId()!;
    useEditor.getState().selectObjectsExpandingGroups([a, c]); // hit a (grouped) + c (loose)
    expect([...useEditor.getState().selectedObjectIds].sort()).toEqual([gid, c].sort());
  });

  it('setGroupTransform writes the group BASE (static; no tracks)', () => {
    const { a, b } = threeRects();
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().groupSelected();
    const gid = groupId()!;
    useEditor.getState().setGroupTransform(gid, { x: 12, scaleX: 2 });
    expect(obj(gid).base.x).toBe(12);
    expect(obj(gid).base.scaleX).toBe(2);
    expect(obj(gid).tracks.x ?? []).toHaveLength(0); // no keyframes
  });

  it('setObjectsTransforms KEYFRAMES a group with auto-key ON, writes base with it OFF (slice 45d)', () => {
    const { a, b } = threeRects();
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().groupSelected();
    const gid = groupId()!;
    // auto-key ON (default): keyframe at the playhead — an animatable group.
    useEditor.getState().setObjectsTransforms([{ id: gid, x: 9, rotation: 30 }]);
    expect(obj(gid).tracks.x ?? []).toHaveLength(1);
    expect(sampleObject(obj(gid), 0).x).toBe(9);
    expect(sampleObject(obj(gid), 0).rotation).toBe(30);
    // auto-key OFF: static base positioning (45b preserved).
    useEditor.getState().toggleAutoKey();
    useEditor.getState().setObjectsTransforms([{ id: gid, scaleX: 2 }]);
    expect(obj(gid).base.scaleX).toBe(2);
    expect(obj(gid).tracks.scaleX ?? []).toHaveLength(0);
  });

  it('ungrouping an ANIMATED group bakes the t=0 transform and drops the group animation (45d v1 limit)', () => {
    const { a, b } = threeRects();
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().groupSelected();
    const gid = groupId()!;
    useEditor.getState().seek(0);
    useEditor.getState().setObjectsTransforms([{ id: gid, x: 0 }]);
    useEditor.getState().seek(1);
    useEditor.getState().setObjectsTransforms([{ id: gid, x: 50 }]); // animate the group
    expect(obj(gid).tracks.x ?? []).toHaveLength(2);
    useEditor.getState().selectObject(gid);
    useEditor.getState().ungroupSelected();
    expect(useEditor.getState().history.present.objects.find((o) => o.isGroup)).toBeUndefined();
    // children baked with the group's T=0 transform (x=0 -> no shift); the +50@t1 is DROPPED.
    expect(obj(a).parentId).toBeUndefined();
    expect(obj(a).base.x).toBe(0);
  });

  it('a group animates: two keyframes at different playhead times interpolate (slice 45d)', () => {
    const { a, b } = threeRects();
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().groupSelected();
    const gid = groupId()!;
    useEditor.getState().seek(0);
    useEditor.getState().setObjectsTransforms([{ id: gid, x: 0 }]); // keyframe x=0 @ t0
    useEditor.getState().seek(1);
    useEditor.getState().setObjectsTransforms([{ id: gid, x: 100 }]); // keyframe x=100 @ t1
    expect(obj(gid).tracks.x ?? []).toHaveLength(2);
    expect(sampleObject(obj(gid), 0.5).x).toBeCloseTo(50); // interpolated (group animates)
  });

  it('ungroupSelected bakes a translated group into children (world position preserved) and removes the group', () => {
    const { a, b } = threeRects();
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().groupSelected();
    const gid = groupId()!;
    useEditor.getState().setGroupTransform(gid, { x: 10, y: 20 }); // move the group
    useEditor.getState().selectObject(gid);
    useEditor.getState().ungroupSelected();
    // group removed; children freed with the group translation baked into their base.
    expect(useEditor.getState().history.present.objects.find((o) => o.isGroup)).toBeUndefined();
    expect(obj(a).parentId).toBeUndefined();
    expect([obj(a).base.x, obj(a).base.y]).toEqual([10, 20]); // a was at (0,0) -> +group(10,20)
    expect([obj(b).base.x, obj(b).base.y]).toEqual([50, 20]); // b was at (40,0) -> +group(10,20)
    expect([...useEditor.getState().selectedObjectIds].sort()).toEqual([a, b].sort());
  });

  it('deleting a group container cascades to its children (no orphans) — review Critical', () => {
    const { a, b, c } = threeRects();
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().groupSelected();
    const gid = groupId()!;
    useEditor.getState().selectObject(gid);
    useEditor.getState().deleteSelectedObject();
    const objs = useEditor.getState().history.present.objects;
    expect(objs.find((o) => o.id === gid)).toBeUndefined(); // group gone
    expect(objs.find((o) => o.id === a)).toBeUndefined(); // child gone (cascade)
    expect(objs.find((o) => o.id === b)).toBeUndefined();
    expect(objs.find((o) => o.id === c)).toBeTruthy(); // the loose object survives
  });

  it('groupSelected excludes objects already in a group (no orphaned parent) — review Important', () => {
    const { a, b, c } = threeRects();
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().groupSelected(); // group1 = {a,b}
    const g1 = groupId()!;
    const groupsBefore = useEditor.getState().history.present.objects.filter((o) => o.isGroup).length;
    useEditor.getState().selectObjects([a, c]); // a is already grouped, c is loose
    useEditor.getState().groupSelected();
    const groupsAfter = useEditor.getState().history.present.objects.filter((o) => o.isGroup).length;
    expect(groupsAfter).toBe(groupsBefore); // a excluded -> <2 targets -> no-op
    expect(obj(a).parentId).toBe(g1); // a stays in its original group
  });
});

describe('nested groups (slice 45e)', () => {
  const obj = (id: string) => useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  function buildNested() {
    useEditor.getState().newProject();
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
    const b = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 80, y: 0, width: 10, height: 10 });
    const c = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().groupSelected(); // inner group {a,b} (selected)
    const inner = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([inner, c]);
    useEditor.getState().groupSelected(); // outer group {inner, c}
    const outer = useEditor.getState().selectedObjectId!;
    return { a, b, c, inner, outer };
  }

  it('groupSelected wraps a top-level group + object in a new OUTER group', () => {
    const { c, inner, outer } = buildNested();
    expect(obj(outer).isGroup).toBe(true);
    expect(obj(outer).parentId).toBeUndefined(); // outer is top-level
    expect(obj(inner).isGroup).toBe(true);
    expect(obj(inner).parentId).toBe(outer); // inner nested in outer
    expect(obj(c).parentId).toBe(outer);
    expect(useEditor.getState().selectedObjectIds).toEqual([outer]);
  });

  it('selecting a doubly-nested child resolves to the OUTERMOST group', () => {
    const { a, outer } = buildNested();
    useEditor.getState().selectObject(null);
    useEditor.getState().selectObjectOrGroup(a); // a is in inner in outer
    expect(useEditor.getState().selectedObjectIds).toEqual([outer]);
  });

  it('deleting a nested OUTER group cascades to grandchildren (no orphans) — review Critical', () => {
    buildNested(); // outer{ inner{a,b}, c }
    const outer = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObject(outer);
    useEditor.getState().deleteSelectedObject();
    expect(useEditor.getState().history.present.objects).toHaveLength(0); // outer+inner+a+b+c all gone
  });

  it('ungrouping the OUTER + INNER group simultaneously leaves no dangling parentId — review Important', () => {
    const { a, b, c, inner, outer } = buildNested();
    useEditor.getState().selectObjects([outer, inner]);
    useEditor.getState().ungroupSelected();
    const objs = useEditor.getState().history.present.objects;
    expect(objs.find((o) => o.isGroup)).toBeUndefined(); // both groups dissolved
    for (const id of [a, b, c]) expect(objs.find((o) => o.id === id)!.parentId).toBeUndefined(); // reparented to root, no dangling
    expect([obj(a).base.x, obj(b).base.x, obj(c).base.x]).toEqual([0, 40, 80]); // identity groups -> world pos preserved
    // the selection holds only surviving (non-group) ids — no dangling dissolved-group id.
    expect([...useEditor.getState().selectedObjectIds].sort()).toEqual([a, b, c].sort());
    expect(useEditor.getState().selectedObjectIds).not.toContain(inner);
  });

  it('ungrouping the OUTER group selects ALL freed children incl. a surviving inner group — review Important', () => {
    const { c, inner, outer } = buildNested(); // outer{ inner{a,b}, c }
    useEditor.getState().selectObject(outer);
    useEditor.getState().ungroupSelected();
    expect(useEditor.getState().history.present.objects.find((o) => o.id === outer)).toBeUndefined(); // outer dissolved
    expect(obj(inner).isGroup).toBe(true); // inner SURVIVES
    expect(obj(inner).parentId).toBeUndefined(); // reparented to root
    // both freed children — the surviving inner group AND leaf c — are selected.
    expect([...useEditor.getState().selectedObjectIds].sort()).toEqual([inner, c].sort());
  });

  it('ungrouping the INNER group reparents its children to the OUTER group (not root)', () => {
    const { a, b, inner, outer } = buildNested();
    useEditor.getState().selectObject(inner);
    useEditor.getState().ungroupSelected();
    expect(useEditor.getState().history.present.objects.find((o) => o.id === inner)).toBeUndefined(); // inner gone
    expect(obj(outer).isGroup).toBe(true); // outer intact
    expect(obj(a).parentId).toBe(outer); // a,b reparented to the grandparent
    expect(obj(b).parentId).toBe(outer);
    expect([obj(a).base.x, obj(b).base.x]).toEqual([0, 40]); // identity groups -> world position preserved
  });
});

describe('drag-reparent (slice 45f)', () => {
  const obj = (id: string) => useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  function setup() {
    useEditor.getState().newProject();
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
    const b = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 50, y: 0, width: 10, height: 10 });
    const c = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().groupSelected();
    const g = useEditor.getState().selectedObjectId!;
    useEditor.getState().setGroupTransform(g, { x: 10 }); // translate the group by +10 (static base)
    return { a, b, c, g };
  }

  it('reparents a top-level object INTO a group, preserving world position', () => {
    const { c, g } = setup();
    useEditor.getState().reparentObject(c, g);
    expect(obj(c).parentId).toBe(g);
    expect(obj(c).base.x).toBe(40); // c world x=50; group x=10 -> local 40 (unbake translate)
  });

  it('reparents a child OUT to root, preserving world position', () => {
    const { a } = setup();
    useEditor.getState().reparentObject(a, null);
    expect(obj(a).parentId).toBeUndefined();
    expect(obj(a).base.x).toBe(10); // a local x=0 in group x=10 -> world 10 (bake translate)
  });

  it('rejects reparenting a group into its own descendant (cycle) and is a no-op for same parent', () => {
    const { a, g } = setup();
    const past = useEditor.getState().history.past.length;
    useEditor.getState().reparentObject(g, a); // a is a child of g -> would cycle
    expect(obj(g).parentId).toBeUndefined();
    expect(useEditor.getState().history.past.length).toBe(past); // no commit
    useEditor.getState().reparentObject(a, g); // a is already in g -> same parent no-op
    expect(useEditor.getState().history.past.length).toBe(past);
  });

  it('reparents an object from one group to a sibling group, preserving world position', () => {
    const { c, g } = setup();
    // a second group {c... } needs >=2; instead make a 2nd group from two fresh rects.
    useEditor.getState().addVectorShape('rect', { x: 100, y: 0, width: 10, height: 10 });
    const d = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 140, y: 0, width: 10, height: 10 });
    const e = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([d, e]);
    useEditor.getState().groupSelected();
    const g2 = useEditor.getState().selectedObjectId!;
    useEditor.getState().setGroupTransform(g2, { x: -5 });
    useEditor.getState().reparentObject(c, g); // c into g (world 50 -> local 40)
    useEditor.getState().reparentObject(c, g2); // then c from g into g2 (world 50 -> g2 local 55)
    expect(obj(c).parentId).toBe(g2);
    expect(obj(c).base.x).toBe(55); // world 50; g2 x=-5 -> local 55
  });
});

describe('align & distribute (slice 43)', () => {
  function rects() {
    useEditor.getState().newProject();
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 40, y: 30, width: 10, height: 10 });
    const b = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 90, y: 5, width: 10, height: 10 });
    const c = useEditor.getState().selectedObjectId!;
    return { a, b, c };
  }
  const aabb = (id: string) => {
    const s = useEditor.getState();
    const o = s.history.present.objects.find((x) => x.id === id)!;
    return objectAABB(o, s.history.present.assets.find((as) => as.id === o.assetId), s.time)!;
  };

  it('alignSelected("left") makes every selected AABB minX equal', () => {
    const { a, b, c } = rects();
    useEditor.getState().selectObjects([a, b, c]);
    useEditor.getState().alignSelected('left');
    expect(Math.abs(aabb(b).minX - aabb(a).minX)).toBeLessThan(1e-6);
    expect(Math.abs(aabb(c).minX - aabb(a).minX)).toBeLessThan(1e-6);
  });

  it('alignSelected is one undo step and respects autoKey off', () => {
    const { a, b, c } = rects();
    useEditor.getState().selectObjects([a, b, c]);
    const past = useEditor.getState().history.past.length;
    useEditor.getState().alignSelected('left');
    expect(useEditor.getState().history.past.length).toBe(past + 1);
    useEditor.getState().toggleAutoKey(); // -> off
    const past2 = useEditor.getState().history.past.length;
    useEditor.getState().alignSelected('right');
    expect(useEditor.getState().history.past.length).toBe(past2); // no-op
  });

  it('distributeSelected("h") equalizes the gaps between AABBs', () => {
    const { a, b, c } = rects();
    useEditor.getState().selectObjects([a, b, c]);
    useEditor.getState().distributeSelected('h');
    const boxes = [aabb(a), aabb(b), aabb(c)].sort((p, q) => p.minX - q.minX);
    const gap1 = boxes[1].minX - boxes[0].maxX;
    const gap2 = boxes[2].minX - boxes[1].maxX;
    expect(Math.abs(gap1 - gap2)).toBeLessThan(1e-6);
  });

  it('a locked member is not moved and does not anchor the alignment', () => {
    const { a, b, c } = rects();
    useEditor.getState().toggleObjectLock(a); // a is leftmost, now locked
    const beforeA = aabb(a).minX;
    useEditor.getState().selectObjects([a, b, c]);
    useEditor.getState().alignSelected('left');
    expect(Math.abs(aabb(a).minX - beforeA)).toBeLessThan(1e-6); // a unmoved (locked)
    expect(Math.abs(aabb(c).minX - aabb(b).minX)).toBeLessThan(1e-6); // b,c align to the movable group
  });
});

describe('booleanOp (slice 46)', () => {
  const square = (s: number, off: number): PathData => ({
    closed: true,
    nodes: [
      { anchor: { x: off, y: off } },
      { anchor: { x: off + s, y: off } },
      { anchor: { x: off + s, y: off + s } },
      { anchor: { x: off, y: off + s } },
    ],
  });

  function addTwoOverlapping(): [string, string] {
    const s = useEditor.getState();
    s.addVectorPath(square(10, 0)); // 0..10  (bottom-most)
    const a = useEditor.getState().selectedObjectId!;
    s.addVectorPath(square(10, 5)); // 5..15  (upper)
    const b = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([a, b]);
    return [a, b];
  }

  beforeEach(() => useEditor.getState().newProject());

  it('union replaces two sources with one selected result', () => {
    addTwoOverlapping();
    const before = useEditor.getState().history.present.objects.length;
    useEditor.getState().booleanOp('union');
    const proj = useEditor.getState().history.present;
    expect(proj.objects.length).toBe(before - 1); // 2 sources -> 1 result
    const sel = useEditor.getState().selectedObjectId!;
    expect(proj.objects.find((o) => o.id === sel)).toBeTruthy();
  });

  it('prunes the source objects orphaned assets (no asset accretion)', () => {
    const [a, b] = addTwoOverlapping();
    const srcAssetIds = useEditor
      .getState()
      .history.present.objects.filter((o) => o.id === a || o.id === b)
      .map((o) => o.assetId);
    useEditor.getState().booleanOp('union');
    const assets = useEditor.getState().history.present.assets;
    // Neither source asset survives; exactly the one new result asset remains.
    expect(srcAssetIds.every((id) => !assets.some((x) => x.id === id))).toBe(true);
    expect(assets.length).toBe(1);
  });

  it('is undoable (restores the sources)', () => {
    addTwoOverlapping();
    const before = useEditor.getState().history.present.objects.map((o) => o.id).sort();
    useEditor.getState().booleanOp('union');
    useEditor.getState().undo();
    const after = useEditor.getState().history.present.objects.map((o) => o.id).sort();
    expect(after).toEqual(before);
  });

  it('interior subtract attaches a compound ring (hole) to the result', () => {
    const s = useEditor.getState();
    s.addVectorPath(square(30, 0)); // big, bottom-most
    const big = useEditor.getState().selectedObjectId!;
    s.addVectorPath(square(10, 10)); // interior, upper
    const small = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([big, small]);
    useEditor.getState().booleanOp('subtract');
    const proj = useEditor.getState().history.present;
    const result = proj.objects.find((o) => o.id === useEditor.getState().selectedObjectId)!;
    const asset = proj.assets.find((a) => a.id === result.assetId) as VectorAsset;
    expect(asset.compoundRings?.length).toBe(1);
  });

  it('no-ops with fewer than 2 eligible (a group in the selection is excluded)', () => {
    const s = useEditor.getState();
    s.addVectorPath(square(10, 0));
    const a = useEditor.getState().selectedObjectId!;
    s.addVectorPath(square(10, 20));
    const b = useEditor.getState().selectedObjectId!;
    s.addVectorPath(square(10, 40));
    const c = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().groupSelected();
    const groupId = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([groupId, c]);
    const before = useEditor.getState().history.present.objects.length;
    useEditor.getState().booleanOp('union');
    expect(useEditor.getState().history.present.objects.length).toBe(before); // unchanged
  });
});

describe('createSymbol (slice 47a)', () => {
  function twoRects() {
    useEditor.getState().newProject();
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
    const b = useEditor.getState().selectedObjectId!;
    return { a, b };
  }
  const present = () => useEditor.getState().history.present;
  const symbols = () => present().assets.filter((a) => a.kind === 'symbol');

  it('moves the selected objects into a new SymbolAsset + one instance, anchored at the bbox centre', () => {
    const { a, b } = twoRects();
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().createSymbol();
    const syms = symbols();
    expect(syms).toHaveLength(1);
    const sym = syms[0];
    expect(sym.kind === 'symbol' && sym.objects.map((o) => o.id).sort()).toEqual([a, b].sort());
    // top level now holds ONE instance referencing the symbol
    expect(present().objects).toHaveLength(1);
    const inst = present().objects[0];
    expect(inst.assetId).toBe(sym.id);
    expect(inst.base).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }); // identity wrapper
    expect([inst.anchorX, inst.anchorY]).toEqual([25, 5]); // a[0..10] + b[40..50] -> centre (25,5)
    expect(useEditor.getState().selectedObjectIds).toEqual([inst.id]);
  });

  it('is undoable (restores the original top-level objects, drops the symbol)', () => {
    const { a, b } = twoRects();
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().createSymbol();
    useEditor.getState().undo();
    expect(symbols()).toHaveLength(0);
    expect(present().objects.map((o) => o.id).sort()).toEqual([a, b].sort());
  });

  it('< 1 selected is a no-op', () => {
    twoRects();
    useEditor.getState().selectObjects([]);
    const past = useEditor.getState().history.past.length;
    useEditor.getState().createSymbol();
    expect(useEditor.getState().history.past.length).toBe(past);
  });

  it('pulls a selected GROUP and its children (with parentId intact) into the symbol scene', () => {
    // Build a group of two rects, then symbol-ize the group container.
    const { a, b } = twoRects();
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().groupSelected();
    const gid = present().objects.find((o) => o.isGroup)!.id;
    useEditor.getState().selectObject(gid);
    useEditor.getState().createSymbol();
    const sym = symbols()[0];
    if (sym.kind !== 'symbol') throw new Error('expected symbol asset');
    // The group container AND both children land inside the symbol, parentId preserved.
    const innerIds = sym.objects.map((o) => o.id).sort();
    expect(innerIds).toEqual([a, b, gid].sort());
    expect(sym.objects.find((o) => o.id === a)!.parentId).toBe(gid);
    expect(sym.objects.find((o) => o.id === b)!.parentId).toBe(gid);
    // Top level holds only the new instance — no dangling group/children left behind.
    expect(present().objects).toHaveLength(1);
    expect(present().objects[0].assetId).toBe(sym.id);
  });

  it('two instances of one symbol share the asset (edit-propagation foundation)', () => {
    const { a, b } = twoRects();
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().createSymbol();
    const symId = symbols()[0].id;
    const instId = present().objects[0].id;
    useEditor.getState().selectObject(instId);
    useEditor.getState().duplicateSelected();
    const instances = present().objects.filter((o) => o.assetId === symId);
    expect(instances).toHaveLength(2); // both read the same SymbolAsset.objects
  });
});

describe('symbol edit mode — store actions (slice 47 edit-mode)', () => {
  function withSymbol(instanceIds: string[] = ['a']) {
    const s = useEditor.getState();
    s.newProject();
    const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
    const innerObj = createSceneObject('inner-asset', { id: 'inner', name: 'inner', zOrder: 0, base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    const sym = createSymbolAsset({ id: 'sym', name: 'Sym', objects: [innerObj], width: 10, height: 10 });
    const p = createProject();
    p.assets = [inner, sym];
    p.objects = instanceIds.map((id, i) => createSceneObject('sym', { id, zOrder: i }));
    s.commit(p);
  }

  it('enterSymbol sets editPath, forces select tool, clears selection', () => {
    withSymbol();
    const s = useEditor.getState();
    s.selectObject('a');
    s.setActiveTool('rect');
    s.enterSymbol('sym');
    expect(useEditor.getState().editPath).toEqual(['sym']);
    expect(useEditor.getState().activeTool).toBe('select');
    expect(useEditor.getState().selectedObjectIds).toEqual([]);
    expect(selectActiveObjects(useEditor.getState()).map((o) => o.id)).toEqual(['inner']);
  });

  it('enterSymbol ignores a non-symbol asset id', () => {
    useEditor.getState().newProject();
    useEditor.getState().enterSymbol('nope');
    expect(useEditor.getState().editPath).toEqual([]);
  });

  it('exitSymbol pops one level and clears selection; exitToDepth truncates', () => {
    withSymbol();
    const s = useEditor.getState();
    s.enterSymbol('sym');
    s.exitSymbol();
    expect(useEditor.getState().editPath).toEqual([]);
    s.enterSymbol('sym');
    s.exitToDepth(0);
    expect(useEditor.getState().editPath).toEqual([]);
  });

  it('commitActiveScene writes back into the symbol asset (and root when not in edit mode)', () => {
    withSymbol();
    const s = useEditor.getState();
    s.enterSymbol('sym');
    const inner = selectActiveObjects(useEditor.getState())[0];
    s.commitActiveScene([{ ...inner, name: 'edited' }]);
    const symAfter = useEditor.getState().history.present.assets.find((x) => x.id === 'sym') as { objects: { name: string }[] };
    expect(symAfter.objects[0].name).toBe('edited');
    expect(useEditor.getState().history.present.objects.map((o) => o.id)).toEqual(['a']);
  });

  it('transforming a symbol internal mutates the asset; all instances reflect it (edit-propagation)', () => {
    withSymbol(['a', 'b']);
    const s = useEditor.getState();
    s.enterSymbol('sym');
    s.selectObject('inner');
    s.setProperties({ x: 25 }); // autoKey defaults true
    const symAfter = useEditor.getState().history.present.assets.find((x) => x.id === 'sym') as { objects: import('../../engine').SceneObject[] };
    expect(sampleObject(symAfter.objects[0], 0).x).toBe(25);
    expect(useEditor.getState().history.present.objects.map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('nudgeSelected and setObjectsTransforms in edit mode write the symbol asset', () => {
    withSymbol();
    const s = useEditor.getState();
    s.enterSymbol('sym');
    s.selectObject('inner');
    s.nudgeSelected(5, 0);
    let symA = useEditor.getState().history.present.assets.find((x) => x.id === 'sym') as { objects: import('../../engine').SceneObject[] };
    expect(sampleObject(symA.objects[0], 0).x).toBe(5);
    s.setObjectsTransforms([{ id: 'inner', x: 9 }]);
    symA = useEditor.getState().history.present.assets.find((x) => x.id === 'sym') as { objects: import('../../engine').SceneObject[] };
    expect(sampleObject(symA.objects[0], 0).x).toBe(9);
  });

  it('setActiveTool: in edit mode allows select/create tools + node; only motion stays gated (phase 3)', () => {
    withSymbol();
    const s = useEditor.getState();
    s.enterSymbol('sym');
    s.setActiveTool('motion');
    expect(useEditor.getState().activeTool).toBe('select'); // motion still gated
    s.setActiveTool('rect');
    expect(useEditor.getState().activeTool).toBe('rect'); // create tool allowed
    s.setActiveTool('node');
    expect(useEditor.getState().activeTool).toBe('node'); // node now allowed (node-edit routed)
  });

  it('undo in edit mode keeps a still-valid internal selection (review)', () => {
    withSymbol();
    const s = useEditor.getState();
    s.enterSymbol('sym');
    s.selectObject('inner');
    s.nudgeSelected(5, 0); // commits a change into the symbol asset
    s.undo();
    expect(useEditor.getState().selectedObjectIds).toEqual(['inner']); // retained (inner still exists)
  });
});

describe('setSymbolTiming (slice 47c)', () => {
  function oneInstance() {
    const s = useEditor.getState();
    s.newProject();
    const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
    const sym = createSymbolAsset({ id: 'sym', objects: [createSceneObject('inner-asset', { id: 'inner' })], width: 10, height: 10 });
    const p = createProject();
    p.assets = [inner, sym];
    p.objects = [createSceneObject('sym', { id: 'a' })];
    s.commit(p);
    s.selectObject('a');
  }

  it('creates symbolTime with defaults merged with the partial', () => {
    oneInstance();
    useEditor.getState().setSymbolTiming({ loop: true });
    const a = useEditor.getState().history.present.objects.find((o) => o.id === 'a')!;
    expect(a.symbolTime).toEqual({ startOffset: 0, loop: true, speed: 1 });
  });

  it('merges onto existing timing and clamps speed > 0 and startOffset >= 0', () => {
    oneInstance();
    useEditor.getState().setSymbolTiming({ loop: true, speed: 2 });
    useEditor.getState().setSymbolTiming({ speed: -5, startOffset: -3 });
    const a = useEditor.getState().history.present.objects.find((o) => o.id === 'a')!;
    expect(a.symbolTime!.loop).toBe(true);
    expect(a.symbolTime!.speed).toBeGreaterThan(0);
    expect(a.symbolTime!.startOffset).toBe(0);
  });

  it('routes to the active scene (works inside a symbol) and is undoable', () => {
    const s = useEditor.getState();
    s.newProject();
    const innerAsset = createVectorAsset('rect', { id: 'r', shapeType: 'rect' });
    const sub = createSymbolAsset({ id: 'sub', objects: [createSceneObject('r', { id: 'leaf' })], width: 10, height: 10 });
    const subInst = createSceneObject('sub', { id: 'subinst' });
    const sym = createSymbolAsset({ id: 'sym', objects: [subInst], width: 10, height: 10 });
    const p = createProject();
    p.assets = [innerAsset, sub, sym];
    p.objects = [createSceneObject('sym', { id: 'top' })];
    s.commit(p);
    s.enterSymbol('sym');
    s.selectObject('subinst');
    s.setSymbolTiming({ loop: true });
    const symAfter = useEditor.getState().history.present.assets.find((x) => x.id === 'sym') as { objects: import('../../engine').SceneObject[] };
    expect(symAfter.objects[0].symbolTime).toEqual({ startOffset: 0, loop: true, speed: 1 });
    s.undo();
    const symBack = useEditor.getState().history.present.assets.find((x) => x.id === 'sym') as { objects: import('../../engine').SceneObject[] };
    expect(symBack.objects[0].symbolTime).toBeUndefined();
  });
});

describe('placeSymbolInstance + swapSymbol (slice 47d)', () => {
  function twoSymbols() {
    const s = useEditor.getState();
    s.newProject();
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const symP = createSymbolAsset({ id: 'symP', name: 'P', objects: [createSceneObject('rect-asset', { id: 'p-leaf' })], width: 10, height: 10 });
    const symQ = createSymbolAsset({ id: 'symQ', name: 'Q', objects: [createSceneObject('rect-asset', { id: 'q-leaf' })], width: 10, height: 10 });
    const p = createProject();
    p.assets = [rectAsset, symP, symQ];
    p.objects = [createSceneObject('symP', { id: 'inst-p' })];
    s.commit(p);
  }

  it('placeSymbolInstance appends an instance to the root scene and selects it', () => {
    twoSymbols();
    useEditor.getState().placeSymbolInstance('symQ');
    const objs = useEditor.getState().history.present.objects;
    expect(objs.filter((o) => o.assetId === 'symQ')).toHaveLength(1);
    expect(useEditor.getState().selectedObjectId).toBe(objs.find((o) => o.assetId === 'symQ')!.id);
  });

  it('placeSymbolInstance appends into the active symbol scene in edit mode', () => {
    twoSymbols();
    const s = useEditor.getState();
    s.enterSymbol('symP');
    s.placeSymbolInstance('symQ');
    const symP = useEditor.getState().history.present.assets.find((a) => a.id === 'symP') as { objects: import('../../engine').SceneObject[] };
    expect(symP.objects.some((o) => o.assetId === 'symQ')).toBe(true);
  });

  it('placeSymbolInstance rejects a cycle (placing P inside P) with no commit', () => {
    twoSymbols();
    const s = useEditor.getState();
    s.enterSymbol('symP');
    const before = useEditor.getState().history.past.length;
    s.placeSymbolInstance('symP');
    expect(useEditor.getState().history.past.length).toBe(before);
    expect((useEditor.getState().history.present.assets.find((a) => a.id === 'symP') as { objects: unknown[] }).objects).toHaveLength(1);
  });

  it('swapSymbol changes only assetId, preserving the transform and symbolTime', () => {
    twoSymbols();
    const s = useEditor.getState();
    s.selectObject('inst-p');
    s.setSymbolTiming({ loop: true });
    s.swapSymbol('inst-p', 'symQ');
    const inst = useEditor.getState().history.present.objects.find((o) => o.id === 'inst-p')!;
    expect(inst.assetId).toBe('symQ');
    expect(inst.symbolTime?.loop).toBe(true);
  });

  it('swapSymbol rejects a cycle-creating swap inside a symbol', () => {
    twoSymbols();
    const s = useEditor.getState();
    s.enterSymbol('symP');
    s.placeSymbolInstance('symQ');
    const qInstId = (useEditor.getState().history.present.assets.find((a) => a.id === 'symP') as { objects: import('../../engine').SceneObject[] }).objects.find((o) => o.assetId === 'symQ')!.id;
    const before = useEditor.getState().history.past.length;
    s.swapSymbol(qInstId, 'symP');
    expect(useEditor.getState().history.past.length).toBe(before);
  });
});

describe('deleteSelectedObject inside a symbol (author-in-symbol delete)', () => {
  function symbolWithTwoParts() {
    const s = useEditor.getState();
    s.newProject();
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const a = createSceneObject('rect-asset', { id: 'pa', zOrder: 0 });
    const b = createSceneObject('rect-asset', { id: 'pb', zOrder: 1 });
    const sym = createSymbolAsset({ id: 'sym', name: 'S', objects: [a, b], width: 10, height: 10 });
    const p = createProject();
    p.assets = [rectAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' }), createSceneObject('sym', { id: 'inst2' })];
    s.commit(p);
  }

  it('deletes an internal object from the symbol scene; both instances reflect it; undo restores', () => {
    symbolWithTwoParts();
    const s = useEditor.getState();
    s.enterSymbol('sym');
    s.selectObject('pa');
    s.deleteSelectedObject();
    const sym = useEditor.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: import('../../engine').SceneObject[] };
    expect(sym.objects.map((o) => o.id)).toEqual(['pb']);
    expect(useEditor.getState().selectedObjectId).toBeNull();
    s.undo();
    const symBack = useEditor.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: import('../../engine').SceneObject[] };
    expect(symBack.objects.map((o) => o.id)).toEqual(['pa', 'pb']);
  });

  it('keeps a vector asset still used inside a symbol when its ROOT user is deleted (cross-scene)', () => {
    const s = useEditor.getState();
    s.newProject();
    const shared = createVectorAsset('rect', { id: 'shared', shapeType: 'rect' });
    const sym = createSymbolAsset({ id: 'sym', objects: [createSceneObject('shared', { id: 'inner' })], width: 10, height: 10 });
    const p = createProject();
    p.assets = [shared, sym];
    p.objects = [createSceneObject('shared', { id: 'root-obj' }), createSceneObject('sym', { id: 'inst' })];
    s.commit(p);
    s.selectObject('root-obj');
    s.deleteSelectedObject();
    expect(useEditor.getState().history.present.assets.some((a) => a.id === 'shared')).toBe(true);
  });

  it('keeps the SymbolAsset when its last instance is deleted (library persists)', () => {
    const s = useEditor.getState();
    s.newProject();
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const sym = createSymbolAsset({ id: 'sym', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
    const p = createProject();
    p.assets = [rectAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'only' })];
    s.commit(p);
    s.selectObject('only');
    s.deleteSelectedObject();
    expect(useEditor.getState().history.present.objects).toHaveLength(0);
    expect(useEditor.getState().history.present.assets.some((a) => a.id === 'sym')).toBe(true);
  });
});

describe('in-symbol draw (author-in-symbol phase 2)', () => {
  function symbolEditing() {
    const s = useEditor.getState();
    s.newProject();
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const sym = createSymbolAsset({ id: 'sym', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
    const p = createProject();
    p.assets = [rectAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' }), createSceneObject('sym', { id: 'inst2' })];
    s.commit(p);
    s.enterSymbol('sym');
  }
  const symObjects = () => (useEditor.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: import('../../engine').SceneObject[] }).objects;

  it('addVectorShape appends a rect to the edited symbol scene + the asset globally; root untouched', () => {
    symbolEditing();
    const beforeAssets = useEditor.getState().history.present.assets.length;
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
    expect(symObjects()).toHaveLength(2);
    expect(useEditor.getState().history.present.assets.length).toBe(beforeAssets + 1);
    expect(useEditor.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1', 'inst2']);
    expect(useEditor.getState().selectedObjectId).toBe(symObjects()[1].id);
  });

  it('addVectorPath inside a symbol appends to the symbol scene and lands on the node tool (phase 3)', () => {
    symbolEditing();
    useEditor.getState().addVectorPath({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }] });
    expect(symObjects()).toHaveLength(2);
    expect(useEditor.getState().activeTool).toBe('node');
  });

  it('addPrimitive inside a symbol appends to the symbol scene', () => {
    symbolEditing();
    useEditor.getState().addPrimitive({ kind: 'polygon', cx: 100, cy: 100, radius: 40, rotation: 0, sides: 5, cornerRadius: 0 });
    expect(symObjects()).toHaveLength(2);
  });

  it('at the root, addVectorPath still lands on the node tool (unchanged)', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorPath({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }] });
    expect(useEditor.getState().activeTool).toBe('node');
    expect(useEditor.getState().history.present.objects).toHaveLength(1);
  });
});

describe('in-symbol node-edit (author-in-symbol phase 3)', () => {
  function symbolWithPath() {
    const s = useEditor.getState();
    s.newProject();
    const pathAsset = createVectorAsset('path', {
      id: 'path-asset',
      path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 20, y: 0 } }] },
    });
    const pathObj = createSceneObject('path-asset', { id: 'p', zOrder: 0 });
    const sym = createSymbolAsset({ id: 'sym', objects: [pathObj], width: 20, height: 10 });
    const p = createProject();
    p.assets = [pathAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' }), createSceneObject('sym', { id: 'inst2' })];
    s.commit(p);
    s.enterSymbol('sym');
    s.selectObject('p');
  }
  const pathAssetNow = () => useEditor.getState().history.present.assets.find((a) => a.id === 'path-asset') as { path: import('../../engine').PathData };
  const symObj0 = () => (useEditor.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: import('../../engine').SceneObject[] }).objects[0];

  it('setPathData inside a symbol edits the global path asset (static branch)', () => {
    symbolWithPath();
    useEditor.getState().setPathData({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 99, y: 0 } }] });
    expect(pathAssetNow().path.nodes).toHaveLength(2);
    expect(pathAssetNow().path.nodes[1].anchor.x).toBe(99);
    expect(useEditor.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1', 'inst2']);
  });

  it('deleteSelectedNode inside a symbol removes a node', () => {
    symbolWithPath();
    useEditor.getState().selectNode(1);
    useEditor.getState().deleteSelectedNode();
    expect(pathAssetNow().path.nodes).toHaveLength(2);
  });

  it('addShapeKeyframe + setPathData inside a symbol write the morph keyframe onto the SYMBOL object', () => {
    symbolWithPath();
    useEditor.getState().addShapeKeyframe();
    expect(symObj0().shapeTrack && symObj0().shapeTrack!.length).toBeGreaterThan(0);
    useEditor.getState().setPathData({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 50, y: 0 } }] });
    const kf = symObj0().shapeTrack![0];
    expect(kf.path.nodes).toHaveLength(2);
    expect(kf.path.nodes[1].anchor.x).toBe(50);
  });

  it('removeShapeKeyframe inside a symbol drops the symbol object shapeTrack (last keyframe)', () => {
    symbolWithPath();
    useEditor.getState().addShapeKeyframe();
    useEditor.getState().removeShapeKeyframe();
    expect(symObj0().shapeTrack ?? []).toHaveLength(0);
  });
});

describe('in-symbol paint (author-in-symbol phase 4)', () => {
  function symbolWithRect() {
    const s = useEditor.getState();
    s.newProject();
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const rectObj = createSceneObject('rect-asset', { id: 'r', zOrder: 0 });
    rectObj.shapeBase = { width: 10, height: 10 };
    const sym = createSymbolAsset({ id: 'sym', objects: [rectObj], width: 10, height: 10 });
    const p = createProject();
    p.assets = [rectAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' }), createSceneObject('sym', { id: 'inst2' })];
    s.commit(p);
    s.enterSymbol('sym');
    s.selectObject('r');
  }
  const symObj0 = () => (useEditor.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: import('../../engine').SceneObject[] }).objects[0];
  const rectAssetNow = () => useEditor.getState().history.present.assets.find((a) => a.id === 'rect-asset') as import('../../engine').VectorAsset;

  it('setVectorColor (auto-key on) writes a colorTracks keyframe onto the SYMBOL object', () => {
    symbolWithRect();
    useEditor.getState().setVectorColor('fill', '#ff0000');
    expect(symObj0().colorTracks?.fill ?? []).toHaveLength(1);
    expect(useEditor.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1', 'inst2']);
  });

  it('setVectorColor (auto-key off) writes the SYMBOL vector asset style.fill', () => {
    symbolWithRect();
    useEditor.getState().toggleAutoKey();
    useEditor.getState().setVectorColor('fill', '#00ff00');
    expect(rectAssetNow().style.fill).toBe('#00ff00');
  });

  it('setVectorStyle updates the vector asset style globally', () => {
    symbolWithRect();
    useEditor.getState().setVectorStyle({ strokeWidth: 9 });
    expect(rectAssetNow().style.strokeWidth).toBe(9);
  });

  it('setStrokeDashoffset (auto-key on) writes a dashOffsetTrack onto the SYMBOL object', () => {
    symbolWithRect();
    useEditor.getState().setStrokeDashoffset(2);
    expect(symObj0().dashOffsetTrack ?? []).toHaveLength(1);
  });

  it('setAnchor writes anchorX/anchorY onto the SYMBOL object (not root)', () => {
    symbolWithRect();
    useEditor.getState().setAnchor(3, 4);
    expect(symObj0().anchorX).toBe(3);
    expect(symObj0().anchorY).toBe(4);
  });
});
