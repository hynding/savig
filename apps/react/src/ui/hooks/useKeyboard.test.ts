import { renderHook } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { useKeyboard } from './useKeyboard';
import { useEditor } from '../store/store';
import type { CommandHost } from '@savig/ui-core';
import { createProject, createSceneObject, createSymbolAsset, createVectorAsset } from '@savig/engine';

const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';

const noopHost: CommandHost = {
  newProject: () => {}, openProject: () => {}, saveProject: () => {}, exportProject: () => {},
  openPalette: () => {}, openShortcuts: () => {}, openTemplates: () => {}, openGettingStarted: () => {}, closeOverlay: () => {},
};

beforeEach(() => {
  useEditor.getState().newProject();
  renderHook(() => useKeyboard(noopHost));
});

it('space toggles play', () => {
  fireEvent.keyDown(window, { key: ' ' });
  expect(useEditor.getState().playing).toBe(true);
});

it('arrow keys nudge the selected object (auto-key)', () => {
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'b', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
  useEditor.getState().addObject('a');
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  expect(useEditor.getState().history.present.objects[0].tracks.x).toBeDefined();
});

it('delete removes the selected keyframe', () => {
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'b', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
  useEditor.getState().addObject('a');
  useEditor.getState().seek(0);
  useEditor.getState().setProperty('x', 5);
  const obj = useEditor.getState().history.present.objects[0];
  useEditor.getState().selectKeyframe({ objectId: obj.id, property: 'x', time: 0 });
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(useEditor.getState().history.present.objects[0].tracks.x).toEqual([]);
});

it('sets tools via V/R/E and Escape returns to select', () => {
  fireEvent.keyDown(window, { key: 'r' });
  expect(useEditor.getState().activeTool).toBe('rect');
  fireEvent.keyDown(window, { key: 'e' });
  expect(useEditor.getState().activeTool).toBe('ellipse');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(useEditor.getState().activeTool).toBe('select');
});

it('P selects pen and N selects node', () => {
  fireEvent.keyDown(window, { key: 'p' });
  expect(useEditor.getState().activeTool).toBe('pen');
  fireEvent.keyDown(window, { key: 'n' });
  expect(useEditor.getState().activeTool).toBe('node');
});

it('selects primitive tools via G/S/L', () => {
  fireEvent.keyDown(window, { key: 'g' });
  expect(useEditor.getState().activeTool).toBe('polygon');
  fireEvent.keyDown(window, { key: 's' });
  expect(useEditor.getState().activeTool).toBe('star');
  fireEvent.keyDown(window, { key: 'l' });
  expect(useEditor.getState().activeTool).toBe('line');
  fireEvent.keyDown(window, { key: 'b' });
  expect(useEditor.getState().activeTool).toBe('brush');
});

it('ignores keys when typing in an input', () => {
  const input = document.createElement('input');
  document.body.appendChild(input);
  fireEvent.keyDown(input, { key: ' ' });
  expect(useEditor.getState().playing).toBe(false);
  input.remove();
});

it('Delete removes a node in node mode but a keyframe otherwise', () => {
  useEditor.getState().addVectorPath({
    nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 20, y: 0 } }],
    closed: false,
  });
  useEditor.getState().setActiveTool('node');
  useEditor.getState().selectNode(1);
  fireEvent.keyDown(window, { key: 'Delete' });
  const asset = useEditor.getState().history.present.assets.find((a) => a.kind === 'vector')!;
  expect(asset.kind === 'vector' && asset.path!.nodes).toHaveLength(2);
});

it('Escape requests a pen-draft cancel and returns to select', () => {
  useEditor.getState().setActiveTool('pen');
  const before = useEditor.getState().cancelPenRequested;
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(useEditor.getState().cancelPenRequested).toBe(before + 1);
  expect(useEditor.getState().activeTool).toBe('select');
});

it('Delete removes the selected shape keyframe before a scalar keyframe', () => {
  useEditor.getState().addVectorPath({
    nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
    closed: false,
  });
  useEditor.getState().addShapeKeyframe();
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().setActiveTool('select');
  useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(useEditor.getState().history.present.objects.find((o) => o.id === id)!.shapeTrack).toBeFalsy();
});

it('Delete removes a selected color keyframe (before shape/scalar)', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
  s.seek(1);
  s.setVectorColor('fill', '#ff0000');
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().setActiveTool('select');
  useEditor.getState().selectColorKeyframe({ objectId: id, property: 'fill', time: 1 });
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(useEditor.getState().history.present.objects[0].colorTracks?.fill ?? []).toHaveLength(0);
  expect(useEditor.getState().selectedColorKeyframe).toBeNull();
});

it('Delete removes a selected gradient keyframe', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
  s.seek(1);
  s.setVectorGradient('fill', {
    type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5,
    stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
  });
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().setActiveTool('select');
  useEditor.getState().selectGradientKeyframe({ objectId: id, property: 'fill', time: 1 });
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(useEditor.getState().history.present.objects[0].gradientTracks?.fill ?? []).toHaveLength(0);
  expect(useEditor.getState().selectedGradientKeyframe).toBeNull();
});

it('Delete removes a selected dash keyframe', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
  s.seek(1);
  s.setStrokeDashoffset(0.5);
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().setActiveTool('select');
  useEditor.getState().selectDashKeyframe({ objectId: id, time: 1 });
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(useEditor.getState().history.present.objects[0].dashOffsetTrack ?? []).toHaveLength(0);
  expect(useEditor.getState().selectedDashKeyframe).toBeNull();
});

it('Delete removes a selected progress keyframe', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().addMotionPath(id, { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }], closed: false });
  useEditor.getState().setActiveTool('select');
  useEditor.getState().selectProgressKeyframe({ objectId: id, time: 0 });
  fireEvent.keyDown(window, { key: 'Delete' });
  const prog = useEditor.getState().history.present.objects[0].motionPath!.progress;
  expect(prog.some((k) => Math.abs(k.time - 0) < 1e-6)).toBe(false);
  expect(useEditor.getState().selectedProgressKeyframe).toBeNull();
});

it('o toggles onion skin', () => {
  expect(useEditor.getState().onionSkin).toBe(false);
  fireEvent.keyDown(window, { key: 'o' });
  expect(useEditor.getState().onionSkin).toBe(true);
});

it('Cmd/Ctrl+D duplicates the selected object', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  expect(useEditor.getState().history.present.objects).toHaveLength(1);
  fireEvent.keyDown(window, { key: 'd', metaKey: true });
  expect(useEditor.getState().history.present.objects).toHaveLength(2);
});

it('Delete removes the selected object when no keyframe is selected', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  s.setActiveTool('select');
  expect(useEditor.getState().history.present.objects).toHaveLength(1);
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(useEditor.getState().history.present.objects).toHaveLength(0);
});

it('Delete removes a selected keyframe, NOT the object', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  s.seek(1);
  s.setProperty('x', 50); // creates a scalar keyframe at t=1
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().setActiveTool('select');
  useEditor.getState().selectKeyframe({ objectId: id, property: 'x', time: 1 });
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(useEditor.getState().history.present.objects).toHaveLength(1); // object kept
  expect(useEditor.getState().history.present.objects[0].tracks.x ?? []).toHaveLength(0); // keyframe gone
});

it('Cmd/Ctrl+] brings the selected object forward', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 0
  s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 1
  const back = useEditor.getState().history.present.objects[0].id;
  useEditor.getState().selectObject(back); // select the back one (zOrder 0)
  fireEvent.keyDown(window, { key: ']', metaKey: true });
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === back)!;
  expect(obj.zOrder).toBe(1); // moved forward
});

it('Cmd/Ctrl+Shift+[ sends the selected object to the back', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const front = useEditor.getState().selectedObjectId!; // zOrder 1
  fireEvent.keyDown(window, { key: '{', metaKey: true, shiftKey: true }); // Shift+[ -> '{'
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === front)!;
  expect(obj.zOrder).toBe(0); // to back
});

it('Cmd/Ctrl+C then Cmd/Ctrl+V copies and pastes the selected object', () => {
  const s = useEditor.getState();
  s.newProject();
  useEditor.setState({ clipboard: null });
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  fireEvent.keyDown(window, { key: 'c', metaKey: true });
  expect(useEditor.getState().clipboard).not.toBeNull();
  fireEvent.keyDown(window, { key: 'v', metaKey: true });
  expect(useEditor.getState().history.present.objects).toHaveLength(2);
});

it('Cmd/Ctrl+X cuts the selected object', () => {
  const s = useEditor.getState();
  s.newProject();
  useEditor.setState({ clipboard: null });
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  fireEvent.keyDown(window, { key: 'x', metaKey: true });
  expect(useEditor.getState().clipboard).not.toBeNull();
  expect(useEditor.getState().history.present.objects).toHaveLength(0);
});

it('does not hijack copy/paste while typing in an input', () => {
  const s = useEditor.getState();
  s.newProject();
  useEditor.setState({ clipboard: null });
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  const input = document.createElement('input');
  document.body.appendChild(input);
  fireEvent.keyDown(input, { key: 'c', metaKey: true });
  expect(useEditor.getState().clipboard).toBeNull(); // native copy, not the object clipboard
  input.remove();
});

it('Cmd/Ctrl+C copies the SELECTED KEYFRAME (not the object) and Cmd/Ctrl+V pastes it', () => {
  const s = useEditor.getState();
  s.newProject();
  useEditor.setState({ clipboard: null, keyframeClipboard: null });
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  const id = useEditor.getState().selectedObjectId!;
  s.seek(0);
  s.setProperty('rotation', 30);
  s.selectKeyframe({ objectId: id, property: 'rotation', time: 0 });
  fireEvent.keyDown(window, { key: 'c', metaKey: true });
  expect(useEditor.getState().keyframeClipboard?.kind).toBe('scalar');
  expect(useEditor.getState().clipboard).toBeNull(); // object NOT copied
  useEditor.getState().seek(1);
  fireEvent.keyDown(window, { key: 'v', metaKey: true });
  expect(useEditor.getState().history.present.objects[0].tracks.rotation).toHaveLength(2);
});

it('Cmd/Ctrl+C copies the OBJECT when no keyframe is selected', () => {
  const s = useEditor.getState();
  s.newProject();
  useEditor.setState({ clipboard: null, keyframeClipboard: null });
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  fireEvent.keyDown(window, { key: 'c', metaKey: true });
  expect(useEditor.getState().clipboard).not.toBeNull(); // object copied
  expect(useEditor.getState().keyframeClipboard).toBeNull();
});

it('Cmd/Ctrl+X cuts the SELECTED KEYFRAME (not the object)', () => {
  const s = useEditor.getState();
  s.newProject();
  useEditor.setState({ clipboard: null, keyframeClipboard: null });
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  const id = useEditor.getState().selectedObjectId!;
  s.seek(0);
  s.setProperty('rotation', 30);
  s.selectKeyframe({ objectId: id, property: 'rotation', time: 0 });
  fireEvent.keyDown(window, { key: 'x', metaKey: true });
  expect(useEditor.getState().keyframeClipboard?.kind).toBe('scalar'); // cut into the keyframe clipboard
  expect(useEditor.getState().history.present.objects[0].tracks.rotation ?? []).toHaveLength(0); // removed
  expect(useEditor.getState().history.present.objects).toHaveLength(1); // object NOT cut
});

it('Delete removes the selected keyframe via the shared action', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  const id = useEditor.getState().selectedObjectId!;
  s.seek(0);
  s.setProperty('x', 5);
  s.selectKeyframe({ objectId: id, property: 'x', time: 0 });
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(useEditor.getState().history.present.objects[0].tracks.x ?? []).toHaveLength(0);
  expect(useEditor.getState().history.present.objects).toHaveLength(1); // object kept
});

it('Cmd+G groups, Cmd+Shift+G ungroups the selection', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  const a = useEditor.getState().selectedObjectId!;
  s.addVectorShape('rect', { x: 40, y: 0, width: 20, height: 20 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  fireEvent.keyDown(window, { key: 'g', metaKey: true });
  const group = useEditor.getState().history.present.objects.find((o) => o.isGroup);
  expect(group).toBeTruthy(); // a group container was created
  expect(useEditor.getState().history.present.objects.find((o) => o.id === a)!.parentId).toBe(group!.id);
  fireEvent.keyDown(window, { key: 'g', metaKey: true, shiftKey: true });
  expect(useEditor.getState().history.present.objects.find((o) => o.isGroup)).toBeUndefined(); // ungrouped
  expect(useEditor.getState().history.present.objects.find((o) => o.id === a)!.parentId).toBeUndefined();
});

it('Escape exits one symbol level when in edit mode', () => {
  const s = useEditor.getState();
  const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', objects: [createSceneObject('inner-asset', { id: 'inner' })], width: 10, height: 10 });
  const p = createProject();
  p.assets = [inner, sym];
  p.objects = [createSceneObject('sym', { id: 'a' })];
  s.commit(p);
  s.enterSymbol('sym');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(useEditor.getState().editPath).toEqual([]);
});

describe('boolean-op shortcuts (Cmd/Ctrl+Shift+U/S/I/E)', () => {
  const twoOverlappingRects = () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 40 });
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 20, y: 0, width: 40, height: 40 }); // overlaps a in [20,40]
    const b = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([a, b]);
  };

  it('Cmd+Shift+U unions the selected vector objects into one path', () => {
    twoOverlappingRects();
    fireEvent.keyDown(window, { key: 'u', metaKey: true, shiftKey: true });
    expect(useEditor.getState().history.present.objects.length).toBe(1); // 2 operands -> 1 result
  });
  it.each([
    ['s', 'subtract'],
    ['i', 'intersect'],
    ['e', 'exclude'],
  ])('Cmd+Shift+%s runs %s (collapses the two operands)', (key) => {
    twoOverlappingRects();
    fireEvent.keyDown(window, { key, metaKey: true, shiftKey: true });
    expect(useEditor.getState().history.present.objects.length).toBe(1);
  });
  it('handles the uppercase key Shift produces (Cmd+Shift+U emits key "U")', () => {
    twoOverlappingRects();
    fireEvent.keyDown(window, { key: 'U', metaKey: true, shiftKey: true }); // real browsers emit uppercase with Shift held
    expect(useEditor.getState().history.present.objects.length).toBe(1);
  });
  it('plain s (no modifier) still selects the star tool, not subtract', () => {
    twoOverlappingRects();
    fireEvent.keyDown(window, { key: 's' });
    expect(useEditor.getState().activeTool).toBe('star');
    expect(useEditor.getState().history.present.objects.length).toBe(2); // no boolean op fired
  });
});
