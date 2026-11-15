import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Timeline } from './Timeline';
import { useEditor } from '../../store/store';
import { PX_PER_SECOND } from './scale';
import { GRAPH_HEIGHT, GRAPH_PAD } from './GraphEditor';
import type { CubicBezierEasing } from '@savig/engine';

beforeEach(() => {
  useEditor.getState().newProject();
  useEditor.setState({ graphEditorOpen: false }); // a view pref: survives newProject
});

function animatedRect(): string {
  const s = useEditor.getState();
  s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  s.seek(0);
  s.setProperty('x', 0);
  s.seek(1, { pastEnd: true });
  s.setProperty('x', 100);
  s.setProperty('opacity', 0.5);
  return useEditor.getState().selectedObjectId!;
}

async function openGraph() {
  render(<Timeline />);
  await userEvent.click(screen.getByTestId('graph-toggle'));
}

describe('motion editor graph', () => {
  it('replaces the track rows while the Graph toggle is on', async () => {
    const id = animatedRect();
    render(<Timeline />);
    expect(screen.getByTestId(`track-row-${id}`)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('graph-toggle'));
    expect(screen.getByTestId('graph-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId(`track-row-${id}`)).toBeNull();
    expect(screen.getByTestId('graph-editor')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('graph-toggle'));
    expect(screen.getByTestId(`track-row-${id}`)).toBeInTheDocument();
  });

  it('explains itself when nothing is selected', async () => {
    await openGraph();
    expect(screen.getByTestId('graph-editor')).toHaveTextContent(/select an animated object/i);
  });

  it('draws keys on the shared time axis, value top-to-bottom', async () => {
    animatedRect();
    await openGraph();
    const k0 = screen.getByTestId('graph-key-x-0');
    const k1 = screen.getByTestId('graph-key-x-1');
    // Diamonds are 10px rects centred on the point.
    expect(Number(k0.getAttribute('x')) + 5).toBeCloseTo(0, 6);
    expect(Number(k1.getAttribute('x')) + 5).toBeCloseTo(PX_PER_SECOND, 6);
    const y0 = Number(k0.getAttribute('y')) + 5;
    const y1 = Number(k1.getAttribute('y')) + 5;
    expect(y1).toBeLessThan(y0); // 100 is above 0
    expect(y0).toBeLessThan(GRAPH_HEIGHT);
    expect(screen.getByTestId('graph-handle-out-0')).toBeInTheDocument();
    expect(screen.getByTestId('graph-handle-in-0')).toBeInTheDocument();
  });

  it('chips switch the focused curve; the other draws faintly', async () => {
    animatedRect();
    await openGraph();
    expect(screen.getByTestId('graph-chip-x')).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByTestId('graph-chip-opacity'));
    expect(screen.getByTestId('graph-chip-opacity')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('graph-key-opacity-1')).toBeInTheDocument();
    expect(screen.queryByTestId('graph-key-x-1')).toBeNull();
    expect(screen.getByTestId('graph-curve-x')).toBeInTheDocument();
  });

  it('clicking a key selects it (the Timeline keyframe selection)', async () => {
    const id = animatedRect();
    await openGraph();
    fireEvent.pointerDown(screen.getByTestId('graph-key-x-1'));
    expect(useEditor.getState().selectedKeyframe).toEqual({ objectId: id, property: 'x', time: 1 });
  });

  // animatedRect: x 0 → 100 over 1s, so the axis is padded to -10..110 (span 120) over the plot.
  const PX_PER_VALUE = (GRAPH_HEIGHT - 2 * GRAPH_PAD) / 120;

  it('dragging a key moves it in time (frame-snapped) and value, in one commit', async () => {
    const id = animatedRect();
    await openGraph();
    const before = useEditor.getState().history.past.length;
    fireEvent.pointerDown(screen.getByTestId('graph-key-x-1'), { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 0.5 * PX_PER_SECOND, clientY: -60 * PX_PER_VALUE });
    // Live preview: the key is drawn at its new place before anything is committed.
    expect(screen.getByTestId('graph-key-x-1.5')).toBeInTheDocument();
    expect(screen.getByTestId('graph-readout')).toHaveTextContent('160 @ 1.5s');
    expect(useEditor.getState().history.past.length).toBe(before);
    fireEvent.pointerUp(window, { clientX: 0.5 * PX_PER_SECOND, clientY: -60 * PX_PER_VALUE });
    const s = useEditor.getState();
    expect(s.history.past.length).toBe(before + 1);
    expect(s.history.present.objects[0].tracks.x!.map((k) => [k.time, k.value])).toEqual([[0, 0], [1.5, 160]]);
    expect(s.selectedKeyframe).toEqual({ objectId: id, property: 'x', time: 1.5 });
  });

  it('Shift keeps a key drag to one axis; Escape cancels', async () => {
    animatedRect();
    await openGraph();
    fireEvent.pointerDown(screen.getByTestId('graph-key-x-1'), { clientX: 0, clientY: 0 });
    fireEvent.pointerUp(window, { clientX: 3, clientY: -40 * PX_PER_VALUE, shiftKey: true }); // mostly vertical
    expect(useEditor.getState().history.present.objects[0].tracks.x!.map((k) => [k.time, k.value])).toEqual([[0, 0], [1, 140]]);
    const before = useEditor.getState().history.past.length;
    fireEvent.pointerDown(screen.getByTestId('graph-key-x-1'), { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 30, clientY: 30 });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(window, { clientX: 30, clientY: 30 });
    expect(useEditor.getState().history.past.length).toBe(before);
  });

  it('a click on a key selects without moving it', async () => {
    animatedRect();
    await openGraph();
    const before = useEditor.getState().history.past.length;
    fireEvent.pointerDown(screen.getByTestId('graph-key-x-1'), { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { clientX: 11, clientY: 10 });
    expect(useEditor.getState().history.past.length).toBe(before);
  });

  it('dragging a handle reshapes the segment easing', async () => {
    animatedRect();
    await openGraph();
    // Out-handle of segment 0 starts at (1/3 s, 33.3); drag it to (0.5 s, 0) → p1 0.5, p2 0.
    fireEvent.pointerDown(screen.getByTestId('graph-handle-out-0'), { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: (0.5 - 1 / 3) * PX_PER_SECOND, clientY: (100 / 3) * PX_PER_VALUE });
    fireEvent.pointerUp(window, { clientX: (0.5 - 1 / 3) * PX_PER_SECOND, clientY: (100 / 3) * PX_PER_VALUE });
    const e = useEditor.getState().history.present.objects[0].tracks.x![0].easing as CubicBezierEasing;
    expect(e.type).toBe('cubicBezier');
    expect(e.p1).toBeCloseTo(0.5, 3);
    expect(e.p2).toBeCloseTo(0, 3);
    // The in-handle keeps linear's equivalent.
    expect(e.p3).toBeCloseTo(2 / 3, 3);
    expect(e.p4).toBeCloseTo(2 / 3, 3);
  });

  it('a locked object cannot be dragged', async () => {
    const id = animatedRect();
    useEditor.getState().toggleObjectLock(id);
    useEditor.setState({ selectedObjectId: id, selectedObjectIds: [id] });
    await openGraph();
    const before = useEditor.getState().history.past.length;
    fireEvent.pointerDown(screen.getByTestId('graph-key-x-1'), { clientX: 0, clientY: 0 });
    fireEvent.pointerUp(window, { clientX: 50, clientY: 50 });
    expect(useEditor.getState().history.past.length).toBe(before);
  });
});
