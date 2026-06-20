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

it('ignores keys when typing in an input', () => {
  const input = document.createElement('input');
  document.body.appendChild(input);
  fireEvent.keyDown(input, { key: ' ' });
  expect(useEditor.getState().playing).toBe(false);
  input.remove();
});
