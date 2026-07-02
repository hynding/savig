import { fireEvent, render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LayersPanel } from './LayersPanel';
import { useEditor } from '../../store/store';
import { createProject, createSceneObject, createSymbolAsset, createVectorAsset } from '@savig/engine';

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
  await userEvent.keyboard('{Escape}');
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

it('the lock button toggles the object lock', async () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const id = useEditor.getState().selectedObjectId!;
  render(<LayersPanel />);
  const btn = screen.getByTestId(`lock-${id}`);
  expect(btn.getAttribute('aria-pressed')).toBe('false');
  await userEvent.click(btn);
  expect(useEditor.getState().history.present.objects[0].locked).toBe(true);
});

it('clicking a locked row does not select the object', async () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().toggleObjectLock(id); // locked + deselected
  render(<LayersPanel />);
  await userEvent.click(screen.getByTestId(`layer-${id}`));
  expect(useEditor.getState().selectedObjectId).toBeNull(); // still not selected
});

it('dragging the back row onto the front row reorders the objects', () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // A back
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 20, y: 20, width: 10, height: 10 }); // B front
  const b = useEditor.getState().selectedObjectId!;
  render(<LayersPanel />);
  fireEvent.dragStart(screen.getByTestId(`layer-${a}`));
  fireEvent.dragOver(screen.getByTestId(`layer-${b}`));
  fireEvent.drop(screen.getByTestId(`layer-${b}`));
  const objs = useEditor.getState().history.present.objects;
  expect(objs.find((o) => o.id === a)!.zOrder).toBeGreaterThan(objs.find((o) => o.id === b)!.zOrder);
});

it('a locked row is not draggable', () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().toggleObjectLock(id);
  render(<LayersPanel />);
  expect(screen.getByTestId(`layer-${id}`).getAttribute('draggable')).toBe('false');
});

it('shift-clicking a second row adds it to the selection (both rows selected)', () => {
  twoRects();
  const objs = useEditor.getState().history.present.objects;
  const back = objs.find((o) => o.zOrder === 0)!;
  const front = objs.find((o) => o.zOrder === 1)!;
  render(<LayersPanel />);
  fireEvent.click(screen.getByTestId(`layer-${back.id}`)); // single-select back
  fireEvent.click(screen.getByTestId(`layer-${front.id}`), { shiftKey: true }); // add front
  expect(useEditor.getState().selectedObjectIds).toEqual([back.id, front.id]);
  expect(screen.getByTestId(`layer-${back.id}`)).toHaveAttribute('data-selected', 'true');
  expect(screen.getByTestId(`layer-${front.id}`)).toHaveAttribute('data-selected', 'true');
});

it('clicking a grouped object row selects the GROUP container (slice 45b)', async () => {
  twoRects();
  const objs = useEditor.getState().history.present.objects;
  const a = objs[0].id;
  const b = objs[1].id;
  useEditor.getState().selectObjects([a, b]);
  useEditor.getState().groupSelected();
  const gid = useEditor.getState().history.present.objects.find((o) => o.isGroup)!.id;
  useEditor.getState().selectObject(null);
  render(<LayersPanel />);
  await userEvent.click(screen.getByTestId(`layer-${a}`));
  expect(useEditor.getState().selectedObjectIds).toEqual([gid]);
});

describe('group tree (slice 45c)', () => {
  function grouped() {
    twoRects();
    const objs = useEditor.getState().history.present.objects;
    const a = objs[0].id;
    const b = objs[1].id;
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().groupSelected();
    const gid = useEditor.getState().history.present.objects.find((o) => o.isGroup)!.id;
    useEditor.getState().selectObject(null);
    return { a, b, gid };
  }

  it('renders a group row with its children nested (depth 1), not at top level', () => {
    const { a, b, gid } = grouped();
    render(<LayersPanel />);
    expect(screen.getByTestId(`layer-${gid}`).getAttribute('data-depth')).toBe('0');
    expect(screen.getByTestId(`layer-${a}`).getAttribute('data-depth')).toBe('1'); // nested child
    expect(screen.getByTestId(`layer-${b}`).getAttribute('data-depth')).toBe('1');
    expect(screen.getByTestId(`disclosure-${gid}`)).toBeInTheDocument();
  });

  it('collapsing a group hides its child rows', async () => {
    const { a, b, gid } = grouped();
    render(<LayersPanel />);
    expect(screen.queryByTestId(`layer-${a}`)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(`disclosure-${gid}`));
    expect(screen.queryByTestId(`layer-${a}`)).toBeNull(); // collapsed
    expect(screen.queryByTestId(`layer-${b}`)).toBeNull();
    expect(screen.getByTestId(`layer-${gid}`)).toBeInTheDocument(); // group row still shown
  });

  it('clicking a child row selects the GROUP', async () => {
    const { a, gid } = grouped();
    render(<LayersPanel />);
    await userEvent.click(screen.getByTestId(`layer-${a}`));
    expect(useEditor.getState().selectedObjectIds).toEqual([gid]);
  });

  it('the group eye toggles the group hidden flag', async () => {
    const { gid } = grouped();
    render(<LayersPanel />);
    await userEvent.click(screen.getByTestId(`vis-${gid}`));
    expect(useEditor.getState().history.present.objects.find((o) => o.id === gid)!.hidden).toBe(true);
  });

  it('child rows ARE draggable (drag-reparent, slice 45f — reverses the 45c restriction)', () => {
    const { a, gid } = grouped();
    render(<LayersPanel />);
    expect(screen.getByTestId(`layer-${gid}`)).toHaveAttribute('draggable', 'true');
    expect(screen.getByTestId(`layer-${a}`)).toHaveAttribute('draggable', 'true'); // child now draggable
  });
});

describe('drag-reparent (slice 45f)', () => {
  function grouped() {
    twoRects();
    const objs = useEditor.getState().history.present.objects;
    const a = objs[0].id;
    const b = objs[1].id;
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().groupSelected();
    const gid = useEditor.getState().history.present.objects.find((o) => o.isGroup)!.id;
    // a 3rd top-level object to drag in.
    useEditor.getState().addVectorShape('rect', { x: 100, y: 0, width: 10, height: 10 });
    const c = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObject(null);
    return { a, b, c, gid };
  }
  const drop = (draggedTid: string, targetTid: string) => {
    fireEvent.dragStart(screen.getByTestId(draggedTid));
    fireEvent.dragOver(screen.getByTestId(targetTid));
    fireEvent.drop(screen.getByTestId(targetTid));
  };
  const obj = (id: string) => useEditor.getState().history.present.objects.find((o) => o.id === id)!;

  it('dropping a top-level row onto a group row reparents it INTO the group', () => {
    const { c, gid } = grouped();
    render(<LayersPanel />);
    drop(`layer-${c}`, `layer-${gid}`);
    expect(obj(c).parentId).toBe(gid);
    expect(screen.getByTestId(`layer-${c}`).getAttribute('data-depth')).toBe('1'); // now nested
  });

  it('dropping a child row onto a top-level non-group row removes it to root', () => {
    const { a, c } = grouped();
    render(<LayersPanel />);
    drop(`layer-${a}`, `layer-${c}`); // a (in group) dropped onto top-level c
    expect(obj(a).parentId).toBeUndefined(); // reparented to root
  });
});

describe('nested groups in the Layers tree (slice 45e)', () => {
  function buildNested() {
    useEditor.getState().newProject();
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 20, y: 0, width: 10, height: 10 });
    const b = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
    const c = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().groupSelected();
    const inner = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([inner, c]);
    useEditor.getState().groupSelected();
    const outer = useEditor.getState().selectedObjectId!;
    return { a, b, c, inner, outer };
  }

  it('renders grandchildren at depth 2', () => {
    const { a, b, inner, outer } = buildNested();
    render(<LayersPanel />);
    expect(screen.getByTestId(`layer-${outer}`).getAttribute('data-depth')).toBe('0');
    expect(screen.getByTestId(`layer-${inner}`).getAttribute('data-depth')).toBe('1');
    expect(screen.getByTestId(`layer-${a}`).getAttribute('data-depth')).toBe('2'); // grandchild
    expect(screen.getByTestId(`layer-${b}`).getAttribute('data-depth')).toBe('2');
  });

  it('collapsing the inner group hides only its grandchildren', async () => {
    const { a, b, c, inner, outer } = buildNested();
    render(<LayersPanel />);
    await userEvent.click(screen.getByTestId(`disclosure-${inner}`));
    expect(screen.queryByTestId(`layer-${a}`)).toBeNull(); // grandchildren hidden
    expect(screen.queryByTestId(`layer-${b}`)).toBeNull();
    expect(screen.getByTestId(`layer-${inner}`)).toBeInTheDocument(); // inner group row kept
    expect(screen.getByTestId(`layer-${c}`)).toBeInTheDocument(); // sibling of inner kept
    expect(screen.getByTestId(`layer-${outer}`)).toBeInTheDocument();
  });
});

it('shows the active symbol scene rows in edit mode (slice 47 edit-mode)', () => {
  const s = useEditor.getState();
  s.newProject();
  const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
  const innerObj = createSceneObject('inner-asset', { id: 'inner', name: 'inner-layer', zOrder: 0 });
  const sym = createSymbolAsset({ id: 'sym', objects: [innerObj], width: 10, height: 10 });
  const p = createProject();
  p.assets = [inner, sym];
  p.objects = [createSceneObject('sym', { id: 'a', name: 'inst-layer' })];
  act(() => { s.commit(p); s.enterSymbol('sym'); });
  render(<LayersPanel />);
  expect(screen.getByText('inner-layer')).toBeInTheDocument();
  expect(screen.queryByText('inst-layer')).not.toBeInTheDocument();
});
