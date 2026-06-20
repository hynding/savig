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

it('disables transform fields when auto-key is off', () => {
  useEditor.getState().toggleAutoKey(); // off
  render(<Inspector />);
  expect(screen.getByLabelText('x')).toBeDisabled();
});

it('shows a hint when nothing is selected', () => {
  useEditor.getState().selectObject(null);
  render(<Inspector />);
  expect(screen.getByText(/no object selected/i)).toBeInTheDocument();
});
