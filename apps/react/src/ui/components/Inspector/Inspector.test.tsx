import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Inspector } from './Inspector';
import { useEditor } from '../../store/store';
import { suggestCorrespondence, createProject, createSceneObject, createSymbolAsset, createTextAsset, createVectorAsset, createKeyframe, sampleObject } from '@savig/engine';
import type { VectorAsset } from '@savig/engine';

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

it('shows the document size panel when nothing is selected', () => {
  useEditor.getState().selectObject(null);
  render(<Inspector />);
  expect(screen.getByText('Document')).toBeInTheDocument();
  expect(screen.getByLabelText('Stage width')).toBeInTheDocument();
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

  it('shift forward rotates the map; closed path shows shift controls', async () => {
    const id = seedTwoShapeKfs(true);
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
    render(<Inspector />);
    // Seed identity via Suggest (square->square => [0,1,2,3]), then shift forward => [1,2,3,0].
    await userEvent.click(screen.getByRole('button', { name: 'Suggest correspondence' }));
    await userEvent.click(screen.getByRole('button', { name: 'Shift correspondence forward' }));
    expect(useEditor.getState().history.present.objects[0].shapeTrack![0].correspondence).toEqual([
      1, 2, 3, 0,
    ]);
  });

  it('Edit links enters correspondence edit mode AND the node tool', async () => {
    const id = seedTwoShapeKfs(true);
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
    useEditor.getState().setActiveTool('select'); // overlay needs the node tool
    render(<Inspector />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit links' }));
    expect(useEditor.getState().correspondenceEditing).toBe(true);
    expect(useEditor.getState().activeTool).toBe('node');
  });

  it('reverse flips winding; open path hides shift but shows reverse', async () => {
    const id = seedTwoShapeKfs(false);
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
    render(<Inspector />);
    expect(screen.queryByRole('button', { name: 'Shift correspondence forward' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Reverse correspondence winding' }));
    // identity [0,1,2] reversed (n=3) => [2,1,0].
    expect(useEditor.getState().history.present.objects[0].shapeTrack![0].correspondence).toEqual([
      2, 1, 0,
    ]);
  });
});

describe('Inspector node easing', () => {
  function seedNodeOnKf(morph?: 'resampled') {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
    s.addShapeKeyframe();
    s.seek(1);
    s.addShapeKeyframe();
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(0);
    if (morph) {
      useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
      useEditor.getState().setSelectedShapeKeyframeMorph('resampled');
    }
    useEditor.getState().selectNode(1);
  }

  it('shows the Node easing editor for a node on a corresponded keyframe and writes nodeEasings', async () => {
    seedNodeOnKf();
    render(<Inspector />);
    expect(screen.getByText(/node 1 — overrides keyframe easing/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'easeIn' }));
    expect(useEditor.getState().history.present.objects[0].shapeTrack![0].nodeEasings).toEqual([undefined, 'easeIn']);
  });

  it('reset clears the node easing back to the keyframe default', async () => {
    seedNodeOnKf();
    useEditor.getState().setSelectedNodeEasing('easeIn');
    render(<Inspector />);
    await userEvent.click(screen.getByRole('button', { name: 'reset to keyframe default' }));
    expect(useEditor.getState().history.present.objects[0].shapeTrack![0].nodeEasings).toBeUndefined();
  });

  it('hides the Node easing section under resampled mode', () => {
    seedNodeOnKf('resampled');
    render(<Inspector />);
    expect(screen.queryByText(/overrides keyframe easing/)).toBeNull();
  });
});

describe('Inspector correspondence summary node count (polish B)', () => {
  it('shows the FROM node count (the map length), not the to count', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
    const id = useEditor.getState().selectedObjectId!;
    const proj = useEditor.getState().history.present;
    const obj = proj.objects.find((o) => o.id === id)!;
    // from-keyframe (kf@0) has 2 nodes; to-keyframe (kf@1) has 3 nodes.
    useEditor.getState().commit({
      ...proj,
      objects: [
        {
          ...obj,
          shapeTrack: [
            { time: 0, easing: 'linear', path: { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false } },
            { time: 1, easing: 'linear', path: { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 5, y: 9 } }, { anchor: { x: 10, y: 0 } }], closed: false } },
          ],
        },
      ],
    });
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
    render(<Inspector />);
    expect(screen.getByText(/auto · 2 nodes/)).toBeInTheDocument(); // from-count = 2
    expect(screen.queryByText(/3 nodes/)).toBeNull();
  });
});

describe('Inspector color animation', () => {
  it('changing the fill color with autoKey on writes a color keyframe', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
    s.seek(1);
    render(<Inspector />);
    fireEvent.change(screen.getByLabelText('fill'), { target: { value: '#ff0000' } });
    expect(useEditor.getState().history.present.objects[0].colorTracks?.fill).toEqual([
      { time: 1, value: '#ff0000', easing: 'linear' },
    ]);
  });
});

describe('Inspector color keyframe editing', () => {
  function seedSelectedColorKf() {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
    s.seek(1);
    s.setVectorColor('fill', '#ff0000');
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectColorKeyframe({ objectId: id, property: 'fill', time: 1 });
  }
  it('shows the selected color keyframe easing and edits it', async () => {
    seedSelectedColorKf();
    render(<Inspector />);
    expect(screen.getByText(/fill @ 1s/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'easeIn' }));
    expect(useEditor.getState().history.present.objects[0].colorTracks!.fill![0].easing).toBe('easeIn');
  });
  it('deletes the selected color keyframe', async () => {
    seedSelectedColorKf();
    render(<Inspector />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete color keyframe' }));
    expect(useEditor.getState().history.present.objects[0].colorTracks?.fill ?? []).toHaveLength(0);
  });
});

describe('Inspector motion path', () => {
  const guide = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }], closed: false };

  it('shows the Motion Path section and toggles orient / removes the guide', async () => {
    const user = userEvent.setup();
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().addMotionPath(id, guide);
    render(<Inspector />);

    const orient = screen.getByLabelText('orient to path');
    expect((orient as HTMLInputElement).checked).toBe(false);
    await user.click(orient);
    expect(useEditor.getState().history.present.objects.find((o) => o.id === id)!.motionPath!.orient).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Remove motion path' }));
    expect(useEditor.getState().history.present.objects.find((o) => o.id === id)!.motionPath).toBeUndefined();
  });

  it('offers "Draw motion path" when the selected object has no guide', () => {
    render(<Inspector />);
    expect(screen.getByRole('button', { name: 'Draw motion path' })).toBeInTheDocument();
  });

  it('shows the easing editor for a selected progress keyframe', () => {
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().addMotionPath(id, guide);
    useEditor.getState().selectProgressKeyframe({ objectId: id, time: 0 });
    render(<Inspector />);
    expect(screen.getByText(/progress @ 0s/)).toBeInTheDocument();
  });
});

describe('Inspector text-on-path (task 3)', () => {
  const STRAIGHT_PATH = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] };

  function seedTextAndPath() {
    const s = useEditor.getState();
    s.newProject();
    const textAsset = createTextAsset({ id: 'text-a' });
    const pathAsset = createVectorAsset('path', { id: 'path-a', path: STRAIGHT_PATH });
    const p = createProject();
    p.assets = [textAsset, pathAsset];
    p.objects = [
      createSceneObject('text-a', { id: 'text1', name: 'My Text', zOrder: 0 }),
      createSceneObject('path-a', { id: 'path1', name: 'My Path', zOrder: 1 }),
    ];
    act(() => {
      s.commit(p);
      s.selectObject('text1');
    });
  }

  it('does not show the Text Path panel for a non-text object', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    render(<Inspector />);
    expect(screen.queryByLabelText('attach to path')).not.toBeInTheDocument();
  });

  it('shows "attach to path" with None + eligible targets for an unbound text object', () => {
    seedTextAndPath();
    render(<Inspector />);
    const select = screen.getByLabelText('attach to path') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.value).toBe('');
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(['None', 'My Path']);
    // Not bound: no offset field, no detach button, no hint.
    expect(screen.queryByLabelText('path offset')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('detach from path')).not.toBeInTheDocument();
    expect(screen.queryByText('Bound text ignores its own transform')).not.toBeInTheDocument();
  });

  it('binding via the select dispatches bindTextPath and re-renders bound (offset + detach + hint)', async () => {
    seedTextAndPath();
    render(<Inspector />);
    const select = screen.getByLabelText('attach to path');
    await userEvent.selectOptions(select, 'path1');
    expect(useEditor.getState().history.present.objects.find((o) => o.id === 'text1')!.textPath).toEqual({
      pathObjectId: 'path1',
      startOffset: 0,
    });
    expect(screen.getByLabelText('path offset')).toBeInTheDocument();
    expect(screen.getByLabelText('detach from path')).toBeInTheDocument();
    expect(screen.getByText('Bound text ignores its own transform')).toBeInTheDocument();
  });

  it('detach button clears the binding and drops the track-strip fields (fresh getState reflects the store effect)', async () => {
    seedTextAndPath();
    useEditor.getState().bindTextPath('path1');
    render(<Inspector />);
    await userEvent.click(screen.getByLabelText('detach from path'));
    expect(useEditor.getState().history.present.objects.find((o) => o.id === 'text1')!.textPath).toBeUndefined();
    expect(screen.queryByLabelText('path offset')).not.toBeInTheDocument();
  });

  it('selecting the empty option on a bound text object unbinds it', async () => {
    seedTextAndPath();
    useEditor.getState().bindTextPath('path1');
    render(<Inspector />);
    const select = screen.getByLabelText('attach to path');
    await userEvent.selectOptions(select, '');
    expect(useEditor.getState().history.present.objects.find((o) => o.id === 'text1')!.textPath).toBeUndefined();
  });

  it('committing the offset field calls setTextPathOffset', async () => {
    seedTextAndPath();
    useEditor.getState().bindTextPath('path1');
    render(<Inspector />);
    const offset = screen.getByLabelText('path offset');
    await userEvent.clear(offset);
    await userEvent.type(offset, '0.5');
    await userEvent.tab();
    const obj = useEditor.getState().history.present.objects.find((o) => o.id === 'text1')!;
    // autoKey defaults ON -> a keyframe, not the base.
    expect(obj.tracks.textPathOffset?.some((k) => k.value === 0.5)).toBe(true);
  });
});

describe('gradient fill', () => {
  beforeEach(() => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 30 });
    useEditor.getState().toggleAutoKey(); // off -> static gradient authoring (Slice 8 path)
  });

  it('switching fill paint to linear assigns a default linear gradient and hides the solid input', async () => {
    render(<Inspector />);
    await userEvent.selectOptions(screen.getByLabelText('fill paint'), 'linear');
    const asset = useEditor.getState().history.present.assets.find((a) => a.kind === 'vector');
    expect(asset && asset.kind === 'vector' && asset.style.fillGradient?.type).toBe('linear');
    expect(screen.queryByLabelText('fill')).not.toBeInTheDocument();
  });

  it('switching fill paint back to solid clears the gradient', async () => {
    useEditor.getState().setVectorGradient('fill', {
      type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5,
      stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
    });
    render(<Inspector />);
    await userEvent.selectOptions(screen.getByLabelText('fill paint'), 'solid');
    const asset = useEditor.getState().history.present.assets.find((a) => a.kind === 'vector');
    expect(asset && asset.kind === 'vector' && asset.style.fillGradient).toBeUndefined();
  });

  it('editing a fill gradient stop color commits a new gradient', () => {
    useEditor.getState().setVectorGradient('fill', {
      type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5,
      stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
    });
    render(<Inspector />);
    fireEvent.change(screen.getByLabelText('fill stop 0 color'), { target: { value: '#ff0000' } });
    const asset = useEditor.getState().history.present.assets.find((a) => a.kind === 'vector');
    expect(asset && asset.kind === 'vector' && asset.style.fillGradient?.stops[0].color).toBe('#ff0000');
  });

  it('adding a stop appends a midpoint stop (sorted by offset)', async () => {
    useEditor.getState().setVectorGradient('fill', {
      type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5,
      stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
    });
    render(<Inspector />);
    await userEvent.click(screen.getByLabelText('add fill stop'));
    const asset = useEditor.getState().history.present.assets.find((a) => a.kind === 'vector');
    const stops = asset && asset.kind === 'vector' ? asset.style.fillGradient?.stops : undefined;
    expect(stops?.length).toBe(3);
    expect(stops?.[1].offset).toBe(0.5);
  });

  it('changing the linear angle updates the endpoints (~top->bottom at 90deg)', () => {
    useEditor.getState().setVectorGradient('fill', {
      type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5,
      stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
    });
    render(<Inspector />);
    const angle = screen.getByLabelText('fill gradient angle');
    fireEvent.change(angle, { target: { value: '90' } });
    fireEvent.blur(angle);
    const asset = useEditor.getState().history.present.assets.find((a) => a.kind === 'vector');
    const g = asset && asset.kind === 'vector' ? asset.style.fillGradient : undefined;
    expect(g && g.type === 'linear' && Math.round(g.y2)).toBe(1);
  });
});

describe('animated gradient', () => {
  function seedFillGradientTrack(): string {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 40, height: 30 });
    const id = useEditor.getState().selectedObjectId!;
    // autoKey defaults on -> each setVectorGradient upserts a keyframe at the playhead.
    const grad = (x2: number) => ({
      type: 'linear' as const,
      x1: 0,
      y1: 0.5,
      x2,
      y2: 0.5,
      stops: [
        { offset: 0, color: '#000000' },
        { offset: 1, color: '#ffffff' },
      ],
    });
    s.seek(0);
    s.setVectorGradient('fill', grad(0));
    s.seek(1);
    s.setVectorGradient('fill', grad(1));
    return id;
  }

  it('reflects the sampled animated gradient as the fill paint type at the playhead', () => {
    seedFillGradientTrack();
    useEditor.getState().seek(1);
    render(<Inspector />);
    expect((screen.getByLabelText('fill paint') as HTMLSelectElement).value).toBe('linear');
  });

  it('shows a Delete gradient keyframe button for the selected gradient keyframe', () => {
    const id = seedFillGradientTrack();
    useEditor.getState().selectGradientKeyframe({ objectId: id, property: 'fill', time: 0 });
    render(<Inspector />);
    expect(screen.getByRole('button', { name: /delete gradient keyframe/i })).toBeInTheDocument();
  });
});

describe('stroke dash UI', () => {
  function seedRect(): string {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 60, height: 40 });
    return useEditor.getState().selectedObjectId!;
  }

  it('toggling "dashed" sets a dash pattern on the asset', async () => {
    seedRect();
    render(<Inspector />);
    await userEvent.click(screen.getByLabelText('dashed'));
    const a = useEditor.getState().history.present.assets.find((x) => x.kind === 'vector')!;
    expect(a.kind === 'vector' && a.style.strokeDasharray).toEqual([1, 1]);
  });

  it('a dashOffsetTrack keyframe shows a Dash keyframe section when selected', () => {
    const id = seedRect();
    useEditor.getState().seek(0);
    useEditor.getState().setStrokeDasharray([1, 1]);
    useEditor.getState().setStrokeDashoffset(1);
    useEditor.getState().selectDashKeyframe({ objectId: id, time: 0 });
    render(<Inspector />);
    expect(screen.getByRole('button', { name: /delete dash keyframe/i })).toBeInTheDocument();
  });
});

describe('trim path UI (Task 8)', () => {
  function seedRect(): string {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 60, height: 40 });
    return useEditor.getState().selectedObjectId!;
  }

  it('shows three enabled trim inputs for a vector without a dash pattern; committing trim end reaches the store', async () => {
    seedRect();
    render(<Inspector />);
    expect(screen.getByLabelText('trim start')).toBeEnabled();
    expect(screen.getByLabelText('trim end')).toBeEnabled();
    expect(screen.getByLabelText('trim offset')).toBeEnabled();
    const end = screen.getByLabelText('trim end');
    await userEvent.clear(end);
    await userEvent.type(end, '0.5');
    await userEvent.tab();
    const obj = useEditor.getState().history.present.objects[0];
    // autoKey is on by default (mirrors the "editing x with auto-key on" test): the committed
    // value lands on the endTrack keyframe, not the base scalar.
    expect(obj.trim?.endTrack?.some((k) => k.value === 0.5)).toBe(true);
  });

  it('hides the trim inputs behind a hint when the object is dashed', () => {
    seedRect();
    useEditor.getState().setStrokeDasharray([1, 1]);
    render(<Inspector />);
    expect(screen.queryByLabelText('trim start')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('trim end')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('trim offset')).not.toBeInTheDocument();
    expect(screen.getByText('Remove dash pattern to use Trim')).toBeInTheDocument();
  });

  it('disables the dashed checkbox with a hint when the object is trimmed', () => {
    seedRect();
    useEditor.getState().drawOn(); // authors obj.trim
    render(<Inspector />);
    expect(screen.getByLabelText('dashed')).toBeDisabled();
    expect(screen.getByText('Remove trim to use dashes')).toBeInTheDocument();
  });

  it('deletes the selected trim keyframe', async () => {
    const id = seedRect();
    useEditor.getState().seek(0);
    useEditor.getState().drawOn(); // trim.endTrack keyframes at 0 and 1
    useEditor.getState().selectTrimKeyframe({ objectId: id, prop: 'end', time: 0 });
    render(<Inspector />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete trim keyframe' }));
    const obj = useEditor.getState().history.present.objects[0];
    expect(obj.trim?.endTrack?.some((k) => k.time === 0)).toBe(false);
  });

  // Reviewer follow-up: the headless core builders (setTrim/setTrimKeyframe) and the MCP
  // set_trim tool don't gate against an existing dash pattern (only the editor store's setTrim
  // does), so an imported .savig can have BOTH obj.trim and style.strokeDasharray set. Before
  // this fix that locked the Inspector: dashed checkbox disabled (trim present) AND trim inputs
  // hidden behind the dash hint (dash present) — no non-destructive way out.
  it('when both trim and dash are set (e.g. an imported project), the dashed checkbox stays enabled so it can be unchecked to reach a valid state', async () => {
    seedRect();
    useEditor.getState().drawOn(); // authors obj.trim
    useEditor.getState().setStrokeDasharray([1, 1]); // bypasses the store's trim gate, like the core/MCP builders do
    render(<Inspector />);
    expect(screen.getByLabelText('dashed')).toBeEnabled();
    expect(screen.queryByText('Remove trim to use dashes')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('dashed')); // uncheck
    expect(useEditor.getState().history.present.objects[0].trim).toBeDefined(); // trim untouched
    expect(screen.getByLabelText('trim start')).toBeInTheDocument(); // no longer hidden behind the dash hint
  });
});

describe('trim path UI: stroke-none hint', () => {
  function seedRect(): string {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 60, height: 40 });
    return useEditor.getState().selectedObjectId!;
  }

  it('shows a hint that trim is invisible when the stroke is none, without disabling the inputs', () => {
    seedRect(); // default vector style has stroke: 'none'
    render(<Inspector />);
    expect(screen.getByText('Add a stroke to see Trim')).toBeInTheDocument();
    expect(screen.getByLabelText('trim start')).toBeEnabled();
    expect(screen.getByLabelText('trim end')).toBeEnabled();
    expect(screen.getByLabelText('trim offset')).toBeEnabled();
  });

  it('does not show the hint once a stroke color is set', () => {
    seedRect();
    useEditor.getState().setVectorStyle({ stroke: '#000000' });
    render(<Inspector />);
    expect(screen.queryByText('Add a stroke to see Trim')).not.toBeInTheDocument();
  });
});

it('the Duplicate button duplicates the selected object', async () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 30, height: 20 });
  render(<Inspector />);
  await userEvent.click(screen.getByRole('button', { name: /duplicate/i }));
  expect(useEditor.getState().history.present.objects).toHaveLength(2);
});

it('the Delete button removes the selected object', async () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 30, height: 20 });
  render(<Inspector />);
  await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
  expect(useEditor.getState().history.present.objects).toHaveLength(0);
});

it('the To Back button lowers the selected object zOrder', async () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 0
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 1 (selected)
  const front = useEditor.getState().selectedObjectId!;
  render(<Inspector />);
  await userEvent.click(screen.getByRole('button', { name: /to back/i }));
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === front)!;
  expect(obj.zOrder).toBe(0);
});

it('shows the Primitive section for a parametric star and edits Points', () => {
  useEditor.getState().addPrimitive({ kind: 'star', cx: 100, cy: 100, radius: 40, rotation: 0, points: 5, innerRatio: 0.5, cornerRadius: 0 });
  useEditor.getState().toggleAutoKey(); // OFF: exercise the spec-overwrite path (Task 3)
  render(<Inspector />);
  const points = screen.getByLabelText('Points');
  fireEvent.change(points, { target: { value: '8' } });
  fireEvent.blur(points);
  const obj = useEditor.getState().history.present.objects.at(-1)!;
  const asset = useEditor.getState().history.present.assets.find((a) => a.id === obj.assetId)!;
  expect((asset as { primitive?: { points?: number } }).primitive?.points).toBe(8);
});

it('shows Sides for a parametric polygon (not Points)', () => {
  useEditor.getState().addPrimitive({ kind: 'polygon', cx: 100, cy: 100, radius: 40, rotation: 0, sides: 6, cornerRadius: 0 });
  render(<Inspector />);
  expect(screen.getByLabelText('Sides')).toBeInTheDocument();
  expect(screen.queryByLabelText('Points')).toBeNull();
});

it('shows a Rotation row in the Primitive section and commits through setPrimitiveParam (autoKey ON -> keyframe)', () => {
  useEditor.getState().addPrimitive({ kind: 'star', cx: 100, cy: 100, radius: 40, rotation: 0, points: 5, innerRatio: 0.5, cornerRadius: 0 });
  expect(useEditor.getState().autoKey).toBe(true); // default ON
  const id = useEditor.getState().selectedObjectId!;
  render(<Inspector />);
  const rotation = screen.getByLabelText('Rotation');
  fireEvent.change(rotation, { target: { value: '45' } });
  fireEvent.blur(rotation);
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  const track = obj.tracks.primitiveRotation;
  expect(track).toBeDefined();
  expect(track?.some((k) => k.value === 45)).toBe(true);
});

it('shows a multi-state when more than one object is selected', () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 20, y: 0, width: 10, height: 10 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  render(<Inspector />);
  expect(screen.getByText(/2 objects selected/i)).toBeInTheDocument();
  const before = useEditor.getState().history.present.objects.length;
  fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
  expect(useEditor.getState().history.present.objects.length).toBe(before + 2);
});

it('multi-state aligns and gates Distribute on >=3 (slice 43)', () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 60, y: 0, width: 10, height: 10 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  const { rerender } = render(<Inspector />);
  expect(screen.getByRole('button', { name: 'Distribute horizontally' })).toBeDisabled(); // 2 selected
  fireEvent.click(screen.getByRole('button', { name: 'Align left' }));
  const xb = useEditor.getState().history.present.objects.find((o) => o.id === b)!.tracks.x;
  expect(xb && xb.length).toBeGreaterThan(0); // b's x track was keyframed by the align
  useEditor.getState().addVectorShape('rect', { x: 120, y: 0, width: 10, height: 10 });
  const c = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b, c]);
  rerender(<Inspector />);
  expect(screen.getByRole('button', { name: 'Distribute horizontally' })).toBeEnabled(); // 3 selected
});

it('Distribute gates on the MOVABLE count, not raw selection (slice 43 review)', () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 60, y: 0, width: 10, height: 10 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 120, y: 0, width: 10, height: 10 });
  const c = useEditor.getState().selectedObjectId!;
  useEditor.getState().toggleObjectLock(c); // 3 selected but only 2 movable
  useEditor.getState().selectObjects([a, b, c]);
  render(<Inspector />);
  expect(screen.getByRole('button', { name: 'Distribute horizontally' })).toBeDisabled(); // movable=2
  expect(screen.getByRole('button', { name: 'Align left' })).toBeEnabled(); // movable>=2
});

it('boolean-op buttons are enabled when 2 vector shapes are selected (slice 46)', () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 5, y: 5, width: 10, height: 10 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  render(<Inspector />);
  expect(screen.getByRole('button', { name: 'Union' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Subtract' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Intersect' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Exclude' })).toBeEnabled();
});

it('boolean-op buttons are ENABLED with a group + a shape (group counts as one operand)', () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 20, y: 0, width: 10, height: 10 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
  const c = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  useEditor.getState().groupSelected();
  const groupId = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([groupId, c]); // group (vector leaves) + a shape => 2 operands
  render(<Inspector />);
  expect(screen.getByRole('button', { name: 'Union' })).toBeEnabled();
});

describe('Shape Builder button (art-tools #7 task 4)', () => {
  it('is enabled with 2 overlapping-eligible rects, and clicking it enters the mode with those ids frozen', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 5, y: 5, width: 10, height: 10 });
    const b = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([a, b]);
    render(<Inspector />);
    const btn = screen.getByRole('button', { name: 'Shape builder' });
    expect(btn).toBeEnabled();
    expect(btn).toHaveTextContent(/shape builder/i);
    fireEvent.click(btn);
    expect(useEditor.getState().shapeBuilder?.ids.slice().sort()).toEqual([a, b].sort());
  });

  it('is disabled when the multi-selection includes a group (group is not a plain vector leaf)', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 20, y: 0, width: 10, height: 10 });
    const b = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
    const c = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().groupSelected();
    const groupId = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([groupId, c]); // 2 selected, one is a group => ineligible
    render(<Inspector />);
    expect(screen.getByRole('button', { name: 'Shape builder' })).toBeDisabled();
  });

  it('reads "Done" and stays enabled while the mode is active, even once the live selection would fail canShapeBuilder; clicking it exits', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 5, y: 5, width: 10, height: 10 });
    const b = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().enterShapeBuilder();
    // Make the (unchanged) [a,b] selection fail canShapeBuilder without disturbing selection
    // itself: single-select `a`, turn on Repeat (a disqualifying flag), then restore [a,b].
    useEditor.getState().selectObject(a);
    useEditor.getState().toggleRepeat();
    useEditor.getState().selectObjects([a, b]);
    expect(useEditor.getState().shapeBuilder).not.toBeNull(); // mode stayed active throughout
    render(<Inspector />);
    const btn = screen.getByRole('button', { name: 'Shape builder' });
    expect(btn).toHaveTextContent('Done');
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(useEditor.getState().shapeBuilder).toBeNull();
  });
});

describe('Blend panel (art-tools #9, task 3)', () => {
  function addTwoBlendablePaths(): { a: string; b: string } {
    useEditor.getState().addVectorPath({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] });
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorPath({ closed: false, nodes: [{ anchor: { x: 0, y: 40 } }, { anchor: { x: 100, y: 40 } }] });
    const b = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([a, b]);
    return { a, b };
  }

  it('renders the blend fields + button for exactly 2 eligible paths, enabled', () => {
    addTwoBlendablePaths();
    render(<Inspector />);
    expect(screen.getByLabelText('blend steps')).toBeInTheDocument();
    expect(screen.getByLabelText('blend easing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Blend' })).toBeEnabled();
  });

  it('defaults blend steps to 3', () => {
    addTwoBlendablePaths();
    render(<Inspector />);
    expect(screen.getByLabelText('blend steps')).toHaveValue(3);
  });

  it('is absent for a single selection', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    render(<Inspector />);
    expect(screen.queryByLabelText('blend steps')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Blend' })).not.toBeInTheDocument();
  });

  it('is absent for a 3-object selection (blend is strictly pairwise)', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 20, y: 0, width: 10, height: 10 });
    const b = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
    const c = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([a, b, c]);
    render(<Inspector />);
    expect(screen.queryByLabelText('blend steps')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Blend' })).not.toBeInTheDocument();
  });

  it('is disabled when the 2-selection is ineligible (e.g. a rect, not a path)', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 20, y: 0, width: 10, height: 10 });
    const b = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([a, b]);
    render(<Inspector />);
    expect(screen.getByRole('button', { name: 'Blend' })).toBeDisabled();
  });

  it('clicking Blend dispatches blendSelected with the field values (count + easing)', () => {
    addTwoBlendablePaths();
    render(<Inspector />);
    fireEvent.change(screen.getByLabelText('blend steps'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('blend easing'), { target: { value: 'easeInOut' } });
    fireEvent.click(screen.getByRole('button', { name: 'Blend' }));
    expect(useEditor.getState().selectedObjectIds).toHaveLength(5); // 5 new intermediates selected
    const newObjs = useEditor.getState().history.present.objects.filter((o) => o.name.startsWith('Blend '));
    expect(newObjs).toHaveLength(5);
  });
});

it('Group creates a container; the group panel offers Ungroup (slice 45b)', () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 20, y: 0, width: 10, height: 10 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  render(<Inspector />);
  expect(screen.queryByRole('button', { name: 'Ungroup' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Group' }));
  // The selection is now the group container; the Inspector shows the group panel.
  const group = useEditor.getState().history.present.objects.find((o) => o.isGroup);
  expect(group).toBeTruthy();
  expect(useEditor.getState().history.present.objects.find((o) => o.id === a)!.parentId).toBe(group!.id);
  expect(screen.getByText(/\(group\)/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ungroup' }));
  expect(useEditor.getState().history.present.objects.find((o) => o.isGroup)).toBeUndefined();
});

it('Create Symbol button turns an eligible multi-selection into a symbol (slice 47a)', async () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  render(<Inspector />);
  const btn = screen.getByRole('button', { name: /create symbol/i });
  expect(btn).toBeEnabled();
  await userEvent.click(btn);
  expect(useEditor.getState().history.present.assets.some((as) => as.kind === 'symbol')).toBe(true);
});

it('Create Symbol is reachable from the single-object panel too (slice 47a, >=1)', async () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  // exactly one object selected -> single-object panel
  render(<Inspector />);
  const btn = screen.getByRole('button', { name: /create symbol/i });
  expect(btn).toBeEnabled();
  await userEvent.click(btn);
  expect(useEditor.getState().history.present.assets.some((as) => as.kind === 'symbol')).toBe(true);
  // exactly one instance now references it
  const sym = useEditor.getState().history.present.assets.find((as) => as.kind === 'symbol')!;
  expect(useEditor.getState().history.present.objects.filter((o) => o.assetId === sym.id)).toHaveLength(1);
});

it('shows a Symbol timing panel for a selected instance and toggles loop (slice 47c)', () => {
  const s = useEditor.getState();
  s.newProject();
  const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', objects: [createSceneObject('inner-asset', { id: 'inner' })], width: 10, height: 10 });
  const p = createProject();
  p.assets = [inner, sym];
  p.objects = [createSceneObject('sym', { id: 'a' })];
  act(() => { s.commit(p); s.selectObject('a'); });
  render(<Inspector />);
  const loop = screen.getByTestId('symbol-loop') as HTMLInputElement;
  expect(loop).toBeInTheDocument();
  act(() => { fireEvent.click(loop); });
  expect(useEditor.getState().history.present.objects.find((o) => o.id === 'a')!.symbolTime?.loop).toBe(true);
});

it('does NOT show the Symbol timing panel for a plain (non-instance) object (slice 47c)', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  render(<Inspector />);
  expect(screen.queryByTestId('symbol-loop')).not.toBeInTheDocument();
});

it('shows a Swap symbol select for an instance and swaps on change (slice 47d)', async () => {
  const s = useEditor.getState();
  s.newProject();
  const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
  const symP = createSymbolAsset({ id: 'symP', name: 'P', objects: [createSceneObject('rect-asset', { id: 'p-leaf' })], width: 10, height: 10 });
  const symQ = createSymbolAsset({ id: 'symQ', name: 'Q', objects: [createSceneObject('rect-asset', { id: 'q-leaf' })], width: 10, height: 10 });
  const p = createProject();
  p.assets = [rectAsset, symP, symQ];
  p.objects = [createSceneObject('symP', { id: 'inst' })];
  act(() => { s.commit(p); s.selectObject('inst'); });
  render(<Inspector />);
  const select = screen.getByTestId('swap-symbol');
  await userEvent.selectOptions(select, 'symQ');
  expect(useEditor.getState().history.present.objects.find((o) => o.id === 'inst')!.assetId).toBe('symQ');
});

it('sets the symbol duration override from the Symbol timing panel (47c)', async () => {
  const s = useEditor.getState();
  s.newProject();
  const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', name: 'Sym', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10, duration: 0 });
  const p = createProject();
  p.assets = [rectAsset, sym];
  p.objects = [createSceneObject('sym', { id: 'inst' })];
  act(() => { s.commit(p); s.selectObject('inst'); });
  render(<Inspector />);
  const field = screen.getByLabelText('symbol duration');
  await userEvent.clear(field);
  await userEvent.type(field, '2{Enter}');
  expect((useEditor.getState().history.present.assets.find((a) => a.id === 'sym') as { duration: number }).duration).toBe(2);
});

it('toggles ping-pong from the Symbol timing panel (47c)', async () => {
  const s = useEditor.getState();
  s.newProject();
  const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', name: 'Sym', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
  const p = createProject();
  p.assets = [rectAsset, sym];
  p.objects = [createSceneObject('sym', { id: 'inst' })];
  act(() => { s.commit(p); s.selectObject('inst'); });
  render(<Inspector />);
  await userEvent.click(screen.getByTestId('symbol-pingpong'));
  expect(useEditor.getState().history.present.objects.find((o) => o.id === 'inst')!.symbolTime?.pingPong).toBe(true);
});

it('sets play count from the Symbol timing panel (47c)', async () => {
  const s = useEditor.getState();
  s.newProject();
  const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', name: 'Sym', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
  const p = createProject();
  p.assets = [rectAsset, sym];
  p.objects = [createSceneObject('sym', { id: 'inst' })];
  act(() => { s.commit(p); s.selectObject('inst'); });
  render(<Inspector />);
  const field = screen.getByLabelText('play count');
  await userEvent.clear(field);
  await userEvent.type(field, '3');
  await userEvent.tab();
  expect(useEditor.getState().history.present.objects.find((o) => o.id === 'inst')!.symbolTime?.playCount).toBe(3);
});

it('sets phase from the Symbol timing panel (47c)', async () => {
  const s = useEditor.getState();
  s.newProject();
  const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', name: 'Sym', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
  const p = createProject();
  p.assets = [rectAsset, sym];
  p.objects = [createSceneObject('sym', { id: 'inst' })];
  act(() => { s.commit(p); s.selectObject('inst'); });
  render(<Inspector />);
  const field = screen.getByLabelText('phase');
  await userEvent.clear(field);
  await userEvent.type(field, '3');
  await userEvent.tab();
  expect(useEditor.getState().history.present.objects.find((o) => o.id === 'inst')!.symbolTime?.phase).toBe(3);
});

it('enables time remap (seeds a track) and keyframes the internal time at the playhead (47c)', async () => {
  const s = useEditor.getState();
  s.newProject();
  const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
  const leaf = createSceneObject('rect-asset', { id: 'leaf' });
  leaf.tracks = { x: [createKeyframe(0, 0), createKeyframe(2, 100)] }; // intrinsic duration 2
  const sym = createSymbolAsset({ id: 'sym', name: 'Sym', objects: [leaf], width: 10, height: 10 });
  const p = createProject();
  p.assets = [rectAsset, sym];
  p.objects = [createSceneObject('sym', { id: 'inst' })];
  act(() => { s.commit(p); s.selectObject('inst'); });
  render(<Inspector />);
  // Enabling seeds the identity curve and reveals the internal-time field; the constant fields disable.
  await userEvent.click(screen.getByTestId('symbol-timeremap'));
  expect(useEditor.getState().history.present.objects.find((o) => o.id === 'inst')!.symbolTimeTrack).toHaveLength(2);
  expect(screen.getByLabelText('speed')).toBeDisabled();
  // Editing the internal-time field upserts a keyframe at the playhead.
  act(() => { useEditor.setState({ time: 1 }); });
  const field = screen.getByLabelText('internal time');
  await userEvent.clear(field);
  await userEvent.type(field, '0.5');
  await userEvent.tab();
  const track = useEditor.getState().history.present.objects.find((o) => o.id === 'inst')!.symbolTimeTrack!;
  expect(track.find((k) => Math.abs(k.time - 1) < 1e-6)!.value).toBeCloseTo(0.5, 6);
});

it('Center on canvas button recenters the selected object (47-followup)', async () => {
  render(<Inspector />);
  const btn = screen.getByLabelText('Center on canvas');
  await userEvent.click(btn);
  const obj = useEditor.getState().history.present.objects[0];
  expect(obj.tracks.x).toBeDefined(); // centerOnCanvas wrote a position (autoKey default on)
  expect(obj.tracks.y).toBeDefined();
});

it('Align-to-canvas edge buttons move the selected object to the artboard edge', async () => {
  render(<Inspector />);
  // The default object sits at the left edge, so align RIGHT is the one that definitely moves it.
  await userEvent.click(screen.getByLabelText('Align right to canvas'));
  const obj = useEditor.getState().history.present.objects[0];
  expect(obj.tracks.x).toBeDefined(); // alignToCanvas('right') wrote an x position (autoKey default on)
});

it('distribute-by-centers buttons appear for a >=3 selection and invoke the action (47-followup)', async () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  const a = useEditor.getState().selectedObjectId!;
  s.addVectorShape('rect', { x: 30, y: 0, width: 60, height: 20 });
  const b = useEditor.getState().selectedObjectId!;
  s.addVectorShape('rect', { x: 200, y: 0, width: 20, height: 20 });
  const c = useEditor.getState().selectedObjectId!;
  s.selectObjects([a, b, c]);
  render(<Inspector />);
  const hBtn = screen.getByLabelText('Distribute horizontal centers');
  expect(hBtn).toBeInTheDocument();
  expect(screen.getByLabelText('Distribute vertical centers')).toBeInTheDocument();
  const before = useEditor.getState().history.past.length;
  await userEvent.click(hBtn);
  expect(useEditor.getState().history.past.length).toBe(before + 1); // the action committed
});

it('distribute-by-spacing input + buttons distribute with an exact gap (>=3 selection)', async () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  const a = useEditor.getState().selectedObjectId!;
  s.addVectorShape('rect', { x: 100, y: 0, width: 20, height: 20 });
  const b = useEditor.getState().selectedObjectId!;
  s.addVectorShape('rect', { x: 300, y: 0, width: 20, height: 20 });
  const c = useEditor.getState().selectedObjectId!;
  s.selectObjects([a, b, c]);
  render(<Inspector />);
  const input = screen.getByLabelText('Distribute spacing value');
  await userEvent.clear(input);
  await userEvent.type(input, '5');
  const before = useEditor.getState().history.past.length;
  await userEvent.click(screen.getByLabelText('Distribute horizontal spacing'));
  expect(useEditor.getState().history.past.length).toBe(before + 1); // committed
  // b lands at a.maxX + gap = 20 + 5 = 25 (a stays at 0)
  const bObj = useEditor.getState().history.present.objects.find((o) => o.id === b)!;
  expect(sampleObject(bObj, 0).x).toBeCloseTo(25, 3);
});

it('Alt+click a boolean button routes to the LIVE boolean (operands kept, result has .boolean)', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  const a = useEditor.getState().selectedObjectId!;
  s.addVectorShape('rect', { x: 10, y: 0, width: 20, height: 20 });
  const b = useEditor.getState().selectedObjectId!;
  act(() => { useEditor.getState().selectObjects([a, b]); });
  render(<Inspector />);
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Union' }), { altKey: true }); });
  const proj = useEditor.getState().history.present;
  const result = proj.objects.find((o) => o.id === useEditor.getState().selectedObjectId)!;
  expect(result.boolean).toEqual({ op: 'union', operandIds: [a, b] });
  expect(proj.objects.some((o) => o.id === a)).toBe(true);
});

it('boolean-op buttons are ENABLED with an SVG object + a shape (SVG counts as one operand)', () => {
  const svg = useEditor.getState().history.present.objects[0].id; // the svg object from beforeEach
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const rect = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([svg, rect]);
  render(<Inspector />);
  expect(screen.getByRole('button', { name: 'Union' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Subtract' })).toBeEnabled();
});

it('empty inspector shows a stage-size panel that resizes the artboard', async () => {
  useEditor.getState().newProject();
  useEditor.getState().selectObject(null); // ensure the empty branch (beforeEach adds+selects an object)
  render(<Inspector />);
  expect(screen.getByText('Document')).toBeInTheDocument();
  const w = screen.getByLabelText('Stage width');
  await userEvent.clear(w);
  await userEvent.type(w, '900');
  await userEvent.tab();
  expect(useEditor.getState().history.present.meta.width).toBe(900);
});

it('a preset resizes both dimensions', async () => {
  useEditor.getState().newProject();
  useEditor.getState().selectObject(null);
  render(<Inspector />);
  await userEvent.selectOptions(screen.getByLabelText('Stage size preset'), '1'); // index 1 = 1080p
  expect(useEditor.getState().history.present.meta.width).toBe(1920);
  expect(useEditor.getState().history.present.meta.height).toBe(1080);
});

it('NumberField self-heals the display even when the clamp is a store no-op', async () => {
  useEditor.getState().newProject();
  useEditor.getState().selectObject(null);
  useEditor.getState().setStageSize(1, 500); // width already at the min
  render(<Inspector />);
  const w = screen.getByLabelText('Stage width') as HTMLInputElement;
  expect(w.value).toBe('1');
  await userEvent.clear(w);
  await userEvent.type(w, '0'); // clamps back to 1 == current -> store no-ops
  await userEvent.tab();
  expect(w.value).toBe('1'); // display healed despite no store change
});

it('empty inspector shows the Symbol size panel and resizes the symbol (not meta) in symbol-edit mode', async () => {
  useEditor.getState().newProject();
  useEditor.getState().addAsset(createSymbolAsset({ id: 'sym', objects: [], width: 100, height: 80 }));
  useEditor.getState().enterSymbol('sym');
  useEditor.getState().selectObject(null); // empty branch while editing the symbol
  render(<Inspector />);
  expect(screen.getByText('Symbol size')).toBeInTheDocument();
  const w = screen.getByLabelText('Stage width') as HTMLInputElement;
  expect(w.value).toBe('100'); // reflects the symbol's intrinsic width, not meta's 1280
  await userEvent.clear(w);
  await userEvent.type(w, '300');
  await userEvent.tab();
  const asset = useEditor.getState().history.present.assets.find((a) => a.id === 'sym');
  expect(asset).toMatchObject({ width: 300, height: 80 });
  expect(useEditor.getState().history.present.meta.width).toBe(1280); // meta untouched
});

describe('Inspector eyedropper pick buttons (style-tools task 3)', () => {
  const originalEyeDropper = (window as unknown as { EyeDropper?: unknown }).EyeDropper;

  afterEach(() => {
    if (originalEyeDropper === undefined) {
      delete (window as unknown as { EyeDropper?: unknown }).EyeDropper;
    } else {
      (window as unknown as { EyeDropper?: unknown }).EyeDropper = originalEyeDropper;
    }
  });

  function seedRectVector() {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
  }

  it('renders no pick buttons when window.EyeDropper is unavailable', () => {
    delete (window as unknown as { EyeDropper?: unknown }).EyeDropper;
    seedRectVector();
    render(<Inspector />);
    expect(screen.queryByLabelText('pick fill color')).toBeNull();
    expect(screen.queryByLabelText('pick stroke color')).toBeNull();
  });

  it('clicking the pick button commits the picked color through setVectorColor (autoKey on writes a keyframe)', async () => {
    (window as unknown as { EyeDropper: unknown }).EyeDropper = class {
      open = async () => ({ sRGBHex: '#123456' });
    };
    seedRectVector();
    useEditor.getState().seek(1);
    render(<Inspector />);
    await userEvent.click(screen.getByLabelText('pick fill color'));
    expect(useEditor.getState().history.present.objects[0].colorTracks?.fill).toEqual([
      { time: 1, value: '#123456', easing: 'linear' },
    ]);
  });

  it('does not throw and makes no state change when the native picker is cancelled (AbortError)', async () => {
    (window as unknown as { EyeDropper: unknown }).EyeDropper = class {
      open = async () => {
        throw new DOMException('cancelled', 'AbortError');
      };
    };
    seedRectVector();
    render(<Inspector />);
    const before = useEditor.getState().history.past.length;
    await userEvent.click(screen.getByLabelText('pick fill color'));
    expect(useEditor.getState().history.past.length).toBe(before);
  });
});

describe('Repeater panel (art-tools #3, task 5)', () => {
  it('the enable checkbox toggles repeat through the store (fresh getState per read)', async () => {
    render(<Inspector />);
    const checkbox = screen.getByLabelText('repeat');
    expect(checkbox).not.toBeChecked();
    expect(useEditor.getState().history.present.objects[0].repeat).toBeUndefined();

    await userEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(useEditor.getState().history.present.objects[0].repeat).toEqual({
      count: 2, dx: 0, dy: 0, rotate: 0, scale: 1, stagger: 0,
    });

    await userEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(useEditor.getState().history.present.objects[0].repeat).toBeUndefined();
  });

  it('only shows the copies/dx/dy/rotate/scale/stagger fields once repeat is on', () => {
    render(<Inspector />);
    expect(screen.queryByLabelText('copies')).toBeNull();

    act(() => useEditor.getState().toggleRepeat());
    expect(screen.getByLabelText('copies')).toBeInTheDocument();
    expect(screen.getByLabelText('repeat dx')).toBeInTheDocument();
    expect(screen.getByLabelText('repeat dy')).toBeInTheDocument();
    expect(screen.getByLabelText('repeat rotate')).toBeInTheDocument();
    expect(screen.getByLabelText('repeat scale')).toBeInTheDocument();
    expect(screen.getByLabelText('stagger')).toBeInTheDocument();
  });

  it('committing "copies" lands in repeat.count (fresh getState())', async () => {
    act(() => useEditor.getState().toggleRepeat());
    render(<Inspector />);
    const copies = screen.getByLabelText('copies');
    await userEvent.clear(copies);
    await userEvent.type(copies, '5');
    await userEvent.tab();
    expect(useEditor.getState().history.present.objects[0].repeat?.count).toBe(5);
  });

  it('is absent (no "repeat" control) for a symbol instance', () => {
    const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
    const sym = createSymbolAsset({
      id: 'sym',
      objects: [createSceneObject('inner-asset', { id: 'inner' })],
      width: 10,
      height: 10,
    });
    const p = createProject();
    p.assets = [inner, sym];
    p.objects = [createSceneObject('sym', { id: 'a' })];
    useEditor.getState().commit(p);
    useEditor.getState().selectObject('a');
    render(<Inspector />);
    expect(screen.queryByLabelText('repeat')).toBeNull();
  });
});

describe('Outline stroke button (Task 2, outline-stroke)', () => {
  it('is enabled for a single selected stroked path and converts the stroke into a fill on click', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorPath({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] });
    render(<Inspector />);
    const btn = screen.getByRole('button', { name: 'Outline stroke' });
    expect(btn).toBeEnabled();

    fireEvent.click(btn);

    const id = useEditor.getState().history.present.objects[0].id;
    const assetId = useEditor.getState().history.present.objects[0].assetId;
    const asset = useEditor.getState().history.present.assets.find((a) => a.id === assetId) as VectorAsset;
    expect(asset.style.fill).toBe('#000000');
    expect(asset.style.stroke).toBe('none');
    void id;
  });

  it('is disabled for a rect (non-path vector)', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    render(<Inspector />);
    expect(screen.getByRole('button', { name: 'Outline stroke' })).toBeDisabled();
  });

  it('is disabled when the path has no visible stroke', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorPath(
      { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] },
      { stroke: 'none' },
    );
    render(<Inspector />);
    expect(screen.getByRole('button', { name: 'Outline stroke' })).toBeDisabled();
  });
});
