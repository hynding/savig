import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Timeline } from './Timeline';
import { useEditor } from '../../store/store';
import { PX_PER_SECOND } from './scale';
import { GRAPH_HEIGHT } from './GraphEditor';

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
});
