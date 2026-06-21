import { beforeEach } from 'vitest';
import { useEditor } from './store';
import { selectProject, selectDuration, selectSelectedObject, selectEditablePath } from './selectors';
import { createProject, sampleObject } from '../../engine';
import type { Gradient, PathData, SvgAsset } from '../../engine';

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
