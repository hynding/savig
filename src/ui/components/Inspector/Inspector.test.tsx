import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Inspector } from './Inspector';
import { useEditor } from '../../store/store';

const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';

beforeEach(() => {
  useEditor.getState().newProject();
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
  useEditor.getState().addObject('a');
});

it('editing x with auto-key on creates a keyframe', async () => {
  render(<Inspector />);
  const x = screen.getByLabelText('x');
  await userEvent.clear(x);
  await userEvent.type(x, '42');
  await userEvent.tab();
  const obj = useEditor.getState().history.present.objects[0];
  expect(obj.tracks.x?.some((k) => k.value === 42)).toBe(true);
});

it('disables transform fields but keeps anchor fields enabled when auto-key is off', () => {
  useEditor.getState().toggleAutoKey(); // off
  render(<Inspector />);
  expect(screen.getByLabelText('x')).toBeDisabled();
  expect(screen.getByLabelText('anchorX')).toBeEnabled();
});

it('editing a field is a single undo step (commits on blur, not per keystroke)', async () => {
  render(<Inspector />);
  const before = useEditor.getState().history.past.length;
  const x = screen.getByLabelText('x');
  await userEvent.clear(x);
  await userEvent.type(x, '100');
  await userEvent.tab();
  expect(useEditor.getState().history.past.length).toBe(before + 1);
});

it('shows a hint when nothing is selected', () => {
  useEditor.getState().selectObject(null);
  render(<Inspector />);
  expect(screen.getByText(/no object selected/i)).toBeInTheDocument();
});

it('shows geometry + style fields for a selected rect vector', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 120, height: 80 });
  render(<Inspector />);
  expect(screen.getByLabelText('width')).toHaveValue(120);
  expect(screen.getByLabelText('height')).toHaveValue(80);
  expect(screen.getByLabelText('fill')).toBeInTheDocument();
  expect(screen.getByLabelText('strokeWidth')).toBeInTheDocument();
});
