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

it('renders cap/join selects and applies them to a vector', async () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  render(<Inspector />);
  await userEvent.selectOptions(screen.getByLabelText('strokeLinecap'), 'round');
  const asset = useEditor.getState().history.present.assets.find((a) => a.kind === 'vector')!;
  expect(asset.kind === 'vector' && asset.style.strokeLinecap).toBe('round');
});

it('shows node count and node-edit buttons for a path in node mode', async () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorPath({
    nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 20, y: 0 } }],
    closed: false,
  });
  useEditor.getState().setActiveTool('node');
  useEditor.getState().selectNode(1);
  render(<Inspector />);
  expect(screen.getByText(/nodes: 3/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /delete node/i }));
  const asset = useEditor.getState().history.present.assets.find((a) => a.kind === 'vector')!;
  expect(asset.kind === 'vector' && asset.path!.nodes).toHaveLength(2);
});

it('does not show scalar geometry fields for a path', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorPath({
    nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 10 } }],
    closed: false,
  });
  render(<Inspector />);
  expect(screen.queryByLabelText('width')).toBeNull();
  expect(screen.queryByLabelText('radiusX')).toBeNull();
});
