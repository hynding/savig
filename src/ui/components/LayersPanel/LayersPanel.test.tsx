import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LayersPanel } from './LayersPanel';
import { useEditor } from '../../store/store';

beforeEach(() => useEditor.getState().newProject());

function twoRects() {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 0
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 1 (front)
}

it('lists objects front-first', () => {
  twoRects();
  const objs = useEditor.getState().history.present.objects;
  const front = objs.find((o) => o.zOrder === 1)!;
  render(<LayersPanel />);
  const rows = screen.getAllByTestId(/^layer-/); // row testids start with "layer-" (eye is "vis-")
  expect(rows[0].getAttribute('data-testid')).toBe(`layer-${front.id}`); // front at top
});

it('clicking a row selects that object', async () => {
  twoRects();
  const back = useEditor.getState().history.present.objects.find((o) => o.zOrder === 0)!;
  render(<LayersPanel />);
  await userEvent.click(screen.getByTestId(`layer-${back.id}`));
  expect(useEditor.getState().selectedObjectId).toBe(back.id);
});

it('clicking the eye toggles visibility without changing selection', async () => {
  twoRects();
  const objs = useEditor.getState().history.present.objects;
  const back = objs.find((o) => o.zOrder === 0)!;
  const front = objs.find((o) => o.zOrder === 1)!; // selected after twoRects
  render(<LayersPanel />);
  await userEvent.click(screen.getByTestId(`vis-${back.id}`));
  expect(useEditor.getState().history.present.objects.find((o) => o.id === back.id)!.hidden).toBe(true);
  expect(useEditor.getState().selectedObjectId).toBe(front.id); // selection unchanged
});

it('double-clicking a name renames the object on Enter', async () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const id = useEditor.getState().selectedObjectId!;
  render(<LayersPanel />);
  await userEvent.dblClick(screen.getByTestId(`layer-${id}`).querySelector('span')!);
  const input = screen.getByTestId(`rename-${id}`) as HTMLInputElement;
  expect(input.value).toBe(useEditor.getState().history.present.objects[0].name);
  await userEvent.clear(input);
  await userEvent.type(input, 'Hero{Enter}');
  expect(useEditor.getState().history.present.objects[0].name).toBe('Hero');
});

it('Escape cancels the rename', async () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const id = useEditor.getState().selectedObjectId!;
  const original = useEditor.getState().history.present.objects[0].name;
  render(<LayersPanel />);
  await userEvent.dblClick(screen.getByTestId(`layer-${id}`).querySelector('span')!);
  const input = screen.getByTestId(`rename-${id}`);
  await userEvent.clear(input);
  await userEvent.type(input, 'Nope');
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(useEditor.getState().history.present.objects[0].name).toBe(original);
});

it('committing an empty name keeps the old name', async () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const id = useEditor.getState().selectedObjectId!;
  const original = useEditor.getState().history.present.objects[0].name;
  render(<LayersPanel />);
  await userEvent.dblClick(screen.getByTestId(`layer-${id}`).querySelector('span')!);
  const input = screen.getByTestId(`rename-${id}`);
  await userEvent.clear(input);
  await userEvent.type(input, '   {Enter}');
  expect(useEditor.getState().history.present.objects[0].name).toBe(original);
});
