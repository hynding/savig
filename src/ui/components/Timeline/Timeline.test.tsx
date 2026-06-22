import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Timeline } from './Timeline';
import { useEditor } from '../../store/store';
import { PX_PER_SECOND } from './scale';

const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';

beforeEach(() => useEditor.getState().newProject());

function withKeyedObject() {
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
  useEditor.getState().addObject('a');
  useEditor.getState().seek(1);
  useEditor.getState().setProperty('x', 50);
  return useEditor.getState().history.present.objects[0].id;
}

describe('ruler & playhead', () => {
  it('clicking the ruler seeks to a frame-snapped time', () => {
    render(<Timeline />);
    fireEvent.pointerDown(screen.getByTestId('timeline-ruler'), { clientX: 0.5 * PX_PER_SECOND });
    expect(useEditor.getState().time).toBeCloseTo(0.5, 5);
  });

  it('positions the playhead at the current time', () => {
    useEditor.setState({ time: 1 });
    render(<Timeline />);
    expect(screen.getByTestId('playhead')).toHaveStyle({ left: `${PX_PER_SECOND}px` });
  });
});

it('toggles onion skin from the header button', async () => {
  render(<Timeline />);
  expect(useEditor.getState().onionSkin).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: /onion/i }));
  expect(useEditor.getState().onionSkin).toBe(true);
});

it('toggles snapping from the header button', async () => {
  render(<Timeline />);
  const before = useEditor.getState().snapEnabled;
  await userEvent.click(screen.getByRole('button', { name: /snap/i }));
  expect(useEditor.getState().snapEnabled).toBe(!before);
  useEditor.getState().setSnapEnabled(true); // restore default
});

describe('tracks & keyframes', () => {
  it('renders a row per object and a diamond per keyframe', () => {
    const id = withKeyedObject();
    render(<Timeline />);
    expect(screen.getByTestId(`track-row-${id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`keyframe-${id}-x-1`)).toBeInTheDocument();
  });

  it('clicking a keyframe selects it', () => {
    const id = withKeyedObject();
    render(<Timeline />);
    fireEvent.pointerDown(screen.getByTestId(`keyframe-${id}-x-1`));
    expect(useEditor.getState().selectedKeyframe).toEqual({ objectId: id, property: 'x', time: 1 });
  });

  it('clicking an object label selects the object', () => {
    const id = withKeyedObject();
    useEditor.getState().selectObject(null);
    render(<Timeline />);
    fireEvent.click(screen.getByTestId(`track-label-${id}`));
    expect(useEditor.getState().selectedObjectId).toBe(id);
  });

  it('renders a dash keyframe diamond and selects it on click', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 30 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(0);
    useEditor.getState().setStrokeDashoffset(1);
    render(<Timeline />);
    const diamond = screen.getByTestId(`dash-keyframe-${id}-0`);
    fireEvent.pointerDown(diamond);
    expect(useEditor.getState().selectedDashKeyframe).toEqual({ objectId: id, time: 0 });
  });

  it('renders a gradient keyframe diamond and selects it on click', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 30 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(0);
    useEditor.getState().setVectorGradient('fill', {
      type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5,
      stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
    });
    render(<Timeline />);
    const diamond = screen.getByTestId(`gradient-keyframe-${id}-fill-0`);
    fireEvent.pointerDown(diamond);
    expect(useEditor.getState().selectedGradientKeyframe).toEqual({ objectId: id, property: 'fill', time: 0 });
  });
});

describe('audio lane & auto-key', () => {
  it('toggles auto-key from the header', async () => {
    render(<Timeline />);
    expect(useEditor.getState().autoKey).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /auto-key/i }));
    expect(useEditor.getState().autoKey).toBe(false);
  });

  it('renders an audio clip bar', () => {
    useEditor.getState().addAsset({ id: 'aud', kind: 'audio', name: 'song', mimeType: 'audio/mpeg' }, new Uint8Array([1]));
    useEditor.getState().seek(0);
    useEditor.getState().addAudioClip('aud');
    const p = useEditor.getState().history.present;
    useEditor.getState().commit({ ...p, audioClips: p.audioClips.map((c) => ({ ...c, outPoint: 2 })) });
    render(<Timeline />);
    const clipId = useEditor.getState().history.present.audioClips[0].id;
    expect(screen.getByTestId(`audio-clip-${clipId}`)).toBeInTheDocument();
  });
});

describe('shape keyframes', () => {
  function morphedPath() {
    useEditor.getState().addVectorPath({
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
      closed: false,
    });
    useEditor.getState().addShapeKeyframe();
    useEditor.getState().seek(1);
    useEditor.getState().setPathData({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 40, y: 0 } }] });
    return useEditor.getState().selectedObjectId!;
  }

  it('renders shape-keyframe diamonds and selects them', () => {
    const id = morphedPath();
    render(<Timeline />);
    const diamond = screen.getByTestId(`shape-keyframe-${id}-1`);
    expect(diamond).toBeInTheDocument();
    fireEvent.pointerDown(diamond);
    expect(useEditor.getState().selectedShapeKeyframe).toEqual({ objectId: id, time: 1 });
  });
});

it('renders a color-keyframe diamond and selects it on pointer down', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
  s.seek(1);
  s.setVectorColor('fill', '#ff0000');
  const id = useEditor.getState().selectedObjectId!;
  render(<Timeline />);
  const diamond = screen.getByTestId(`color-keyframe-${id}-fill-1`);
  fireEvent.pointerDown(diamond);
  expect(useEditor.getState().selectedColorKeyframe).toEqual({ objectId: id, property: 'fill', time: 1 });
});

it('renders progress keyframes and selects one on click', () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().addMotionPath(id, { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }], closed: false });
  render(<Timeline />);
  const diamond = screen.getByTestId(`progress-keyframe-${id}-0`);
  fireEvent.pointerDown(diamond);
  expect(useEditor.getState().selectedProgressKeyframe).toEqual({ objectId: id, time: 0 });
});

describe('drag-to-retime', () => {
  it('dragging a keyframe diamond changes its time', () => {
    const id = withKeyedObject(); // a scalar x keyframe at t=1
    render(<Timeline />);
    const diamond = screen.getByTestId(`keyframe-${id}-x-1`);
    fireEvent.pointerDown(diamond, { clientX: 1 * PX_PER_SECOND }); // grab at t=1
    fireEvent.pointerMove(window, { clientX: 2 * PX_PER_SECOND }); // drag +1s
    fireEvent.pointerUp(window, { clientX: 2 * PX_PER_SECOND });
    const track = useEditor.getState().history.present.objects[0].tracks.x!;
    expect(track.some((k) => Math.abs(k.time - 2) < 1e-6)).toBe(true); // now at t=2
    expect(track.some((k) => Math.abs(k.time - 1) < 1e-6)).toBe(false); // gone from t=1
  });

  it('a click (no movement) selects without retiming', () => {
    const id = withKeyedObject();
    render(<Timeline />);
    const diamond = screen.getByTestId(`keyframe-${id}-x-1`);
    fireEvent.pointerDown(diamond, { clientX: 1 * PX_PER_SECOND });
    fireEvent.pointerUp(window, { clientX: 1 * PX_PER_SECOND }); // same x -> no move
    expect(useEditor.getState().selectedKeyframe).toEqual({ objectId: id, property: 'x', time: 1 });
    expect(useEditor.getState().history.present.objects[0].tracks.x).toHaveLength(1); // still one, at t=1
  });
});

describe('lock-aware timeline', () => {
  function lockedKeyedObject() {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(1);
    useEditor.getState().setProperty('x', 50); // x keyframe at t=1
    useEditor.getState().toggleObjectLock(id); // locks + deselects
    return id;
  }

  it('clicking a locked object keyframe diamond does NOT select it', () => {
    const id = lockedKeyedObject();
    render(<Timeline />);
    fireEvent.pointerDown(screen.getByTestId(`keyframe-${id}-x-1`));
    expect(useEditor.getState().selectedKeyframe).toBeNull();
  });

  it('dragging a locked object keyframe diamond does NOT retime it', () => {
    const id = lockedKeyedObject();
    render(<Timeline />);
    const diamond = screen.getByTestId(`keyframe-${id}-x-1`);
    fireEvent.pointerDown(diamond, { clientX: 1 * PX_PER_SECOND });
    fireEvent.pointerMove(window, { clientX: 2 * PX_PER_SECOND });
    fireEvent.pointerUp(window, { clientX: 2 * PX_PER_SECOND });
    const track = useEditor.getState().history.present.objects[0].tracks.x!;
    expect(track.some((k) => Math.abs(k.time - 1) < 1e-6)).toBe(true); // still at t=1
    expect(track.some((k) => Math.abs(k.time - 2) < 1e-6)).toBe(false); // not retimed
  });

  it('clicking a locked object row label does NOT select the object', () => {
    const id = lockedKeyedObject();
    render(<Timeline />);
    fireEvent.click(screen.getByTestId(`track-label-${id}`));
    expect(useEditor.getState().selectedObjectId).toBeNull();
  });

  it('a locked object row is dimmed (has the locked class)', () => {
    const id = lockedKeyedObject();
    render(<Timeline />);
    expect(screen.getByTestId(`track-row-${id}`).className).toMatch(/locked/);
  });
});
