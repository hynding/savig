import { renderHook } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { useKeyboard } from './useKeyboard';
import { useEditor } from '../store/store';

const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';

beforeEach(() => {
  useEditor.getState().newProject();
  renderHook(() => useKeyboard());
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
