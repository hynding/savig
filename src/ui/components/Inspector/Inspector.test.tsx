import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Inspector } from './Inspector';
import { useEditor } from '../../store/store';
import { suggestCorrespondence } from '../../../engine';

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

it('adds and removes a shape keyframe from the Path group', async () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorPath({
    nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
    closed: false,
  });
  render(<Inspector />);
  const objId = useEditor.getState().selectedObjectId!;
  await userEvent.click(screen.getByRole('button', { name: /add shape keyframe/i }));
  expect(useEditor.getState().history.present.objects.find((o) => o.id === objId)!.shapeTrack).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: /remove shape keyframe/i }));
  expect(useEditor.getState().history.present.objects.find((o) => o.id === objId)!.shapeTrack).toBeFalsy();
});

it('disables Remove shape keyframe when the playhead is not on a keyframe', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorPath({
    nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
    closed: false,
  });
  useEditor.getState().addShapeKeyframe(); // keyframe at t=0
  useEditor.getState().seek(1);            // playhead off the keyframe
  render(<Inspector />);
  expect(screen.getByRole('button', { name: /remove shape keyframe/i })).toBeDisabled();
});

it("'nodes:' count reflects the sampled morph shape, not the static base", () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorPath({
    nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 20, y: 0 } }],
    closed: false,
  });
  useEditor.getState().addShapeKeyframe();
  useEditor.getState().seek(1);
  useEditor.getState().selectNode(1);
  useEditor.getState().deleteSelectedNode(); // keyframe at t=1 has 2 nodes; base still 3
  render(<Inspector />);
  expect(screen.getByText(/nodes:\s*2/)).toBeInTheDocument();
});

describe('keyframe easing section', () => {
  it('shows the Keyframe section with the scalar header and edits easing', async () => {
    useEditor.getState().newProject();
    useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
    useEditor.getState().addObject('a');
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('x', 10);
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectKeyframe({ objectId: id, property: 'x', time: 0 });
    render(<Inspector />);
    expect(screen.getByText(/^x @ 0s$/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'easeIn' }));
    expect(useEditor.getState().history.present.objects[0].tracks.x![0].easing).toBe('easeIn');
  });

  it('shows a rotationMode toggle only for a rotation keyframe', () => {
    useEditor.getState().newProject();
    useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
    useEditor.getState().addObject('a');
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('rotation', 90);
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectKeyframe({ objectId: id, property: 'rotation', time: 0 });
    render(<Inspector />);
    expect(screen.getByLabelText('rotationMode')).toBeInTheDocument();
  });

  it('shows the shape header and no rotationMode toggle for a selected shape keyframe', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
    useEditor.getState().addShapeKeyframe();
    const id = useEditor.getState().selectedObjectId!;
    const t = useEditor.getState().history.present.objects[0].shapeTrack![0].time;
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: t });
    render(<Inspector />);
    expect(screen.getByText(new RegExp(`^shape @ ${t}s$`))).toBeInTheDocument();
    expect(screen.queryByLabelText('rotationMode')).toBeNull();
  });

  it('does not show the Keyframe section when no keyframe is selected', () => {
    useEditor.getState().newProject();
    useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
    useEditor.getState().addObject('a');
    render(<Inspector />);
    expect(screen.queryByText(/Keyframe/)).toBeNull();
  });

  it('shows the morph toggle for a shape keyframe and sets the mode', async () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
    useEditor.getState().addShapeKeyframe();
    const id = useEditor.getState().selectedObjectId!;
    const t = useEditor.getState().history.present.objects[0].shapeTrack![0].time;
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: t });
    render(<Inspector />);
    const sel = screen.getByLabelText('morph mode');
    expect(sel).toBeInTheDocument();
    await userEvent.selectOptions(sel, 'resampled');
    expect(useEditor.getState().history.present.objects[0].shapeTrack![0].morph).toBe('resampled');
  });

  it('does not show the morph toggle for a scalar keyframe', () => {
    useEditor.getState().newProject();
    useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
    useEditor.getState().addObject('a');
    useEditor.getState().seek(0);
    useEditor.getState().setProperty('x', 10);
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectKeyframe({ objectId: id, property: 'x', time: 0 });
    render(<Inspector />);
    expect(screen.queryByLabelText('morph mode')).toBeNull();
  });
});

describe('Inspector correspondence controls', () => {
  function seedTwoShapeKfs(closed: boolean) {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorPath({
      nodes: closed
        ? [
            { anchor: { x: 0, y: 0 } },
            { anchor: { x: 10, y: 0 } },
            { anchor: { x: 10, y: 10 } },
            { anchor: { x: 0, y: 10 } },
          ]
        : [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 20, y: 0 } }],
      closed,
    });
    s.addShapeKeyframe();
    s.seek(1);
    s.addShapeKeyframe();
    const id = useEditor.getState().selectedObjectId!;
    return id;
  }

  it('shows Suggest for a corresponded shape keyframe with a next keyframe and writes the map', async () => {
    const id = seedTwoShapeKfs(true);
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
    render(<Inspector />);

    await userEvent.click(screen.getByRole('button', { name: 'Suggest correspondence' }));

    const track = useEditor.getState().history.present.objects[0].shapeTrack!;
    expect(track[0].correspondence).toEqual(suggestCorrespondence(track[0].path, track[1].path));
    expect(screen.getByText(/suggested · 4 nodes/)).toBeInTheDocument();
  });

  it('hides the Correspondence group for the last shape keyframe (no transition)', () => {
    const id = seedTwoShapeKfs(false);
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: 1 }); // last kf
    render(<Inspector />);
    expect(screen.queryByRole('button', { name: 'Suggest correspondence' })).toBeNull();
  });

  it('hides the Correspondence group under resampled mode', () => {
    const id = seedTwoShapeKfs(false);
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
    useEditor.getState().setSelectedShapeKeyframeMorph('resampled');
    render(<Inspector />);
    expect(screen.queryByRole('button', { name: 'Suggest correspondence' })).toBeNull();
  });
});
