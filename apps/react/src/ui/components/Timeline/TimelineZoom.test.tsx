// Timeline zoom: header controls, Ctrl/⌘+wheel, and every surface (ruler, playhead, frame strip)
// following the same scale.
import { render, screen, fireEvent } from '@testing-library/react';
import { Timeline } from './Timeline';
import { useEditor } from '../../store/store';
import { PX_PER_SECOND, TRACK_LABEL_WIDTH } from './scale';
import { createFrameLayer, createProject } from '@savig/engine';

const FPS = 10;

beforeEach(() => {
  useEditor.getState().setTimelineZoom(1);
  const L = createFrameLayer({ id: 'L', name: 'Layer', zOrder: 0, keys: [{ id: 'a', time: 0 }, { id: 'b', time: 0.3 }], end: 1 });
  useEditor.getState().setProject({ ...createProject({ fps: FPS, duration: 4, durationMode: 'manual' }), objects: [L] });
});

const zoom = () => useEditor.getState().timelineZoom;

describe('timeline zoom controls', () => {
  it('+ / − step the zoom and the readout follows; the readout resets to 100%', () => {
    render(<Timeline />);
    expect(screen.getByTestId('timeline-zoom')).toHaveTextContent('100%');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom timeline in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom timeline in' }));
    expect(zoom()).toBe(2);
    expect(screen.getByTestId('timeline-zoom')).toHaveTextContent('200%');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom timeline out' }));
    expect(zoom()).toBe(1.5);
    fireEvent.click(screen.getByRole('button', { name: 'Reset timeline zoom' }));
    expect(zoom()).toBe(1);
  });

  it('Ctrl+wheel zooms (wheel up = in); a plain wheel only scrolls', () => {
    render(<Timeline />);
    const scroll = screen.getByTestId('timeline-scroll');
    fireEvent.wheel(scroll, { deltaY: 100 });
    expect(zoom()).toBe(1);
    fireEvent.wheel(scroll, { deltaY: -100, ctrlKey: true });
    expect(zoom()).toBeGreaterThan(1);
    const zoomed = zoom();
    fireEvent.wheel(scroll, { deltaY: 100, metaKey: true });
    expect(zoom()).toBeLessThan(zoomed);
  });

  it('Fit sizes the whole duration to the visible width', () => {
    render(<Timeline />);
    const scroll = screen.getByTestId('timeline-scroll');
    Object.defineProperty(scroll, 'clientWidth', { configurable: true, value: TRACK_LABEL_WIDTH + 12 + 800 });
    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    expect(zoom()).toBeCloseTo(800 / (4 * PX_PER_SECOND)); // 4s into 800px → 200 px/s
  });
});

describe('surfaces follow the zoom', () => {
  it('playhead, ruler scrub and frame keys all use the zoomed scale', () => {
    useEditor.getState().setTimelineZoom(4);
    useEditor.getState().seek(0.5);
    render(<Timeline />);
    const pps = 4 * PX_PER_SECOND;
    expect(screen.getByTestId('playhead')).toHaveStyle({ left: `${TRACK_LABEL_WIDTH + 0.5 * pps}px` });
    expect(screen.getByTestId('frame-key-b')).toHaveStyle({ left: `${0.3 * pps}px` });
    expect(screen.getByTestId('timeline-ruler')).toHaveStyle({ minWidth: `${4 * pps}px` });
    fireEvent.pointerDown(screen.getByTestId('timeline-ruler'), { clientX: 0.22 * pps });
    expect(useEditor.getState().time).toBeCloseTo(0.2, 5); // 0.22 s → nearest 10 fps frame
    // A strip click lands on the cell under the pointer at the zoomed size.
    fireEvent.pointerDown(screen.getByTestId('frame-strip-L'), { clientX: 0.75 * pps });
    expect(useEditor.getState().time).toBeCloseTo(0.7, 5);
  });

  it('numbers frames on the ruler only when cells are wide enough', () => {
    const { unmount } = render(<Timeline />);
    expect(screen.queryByTestId('ruler-frame-2')).toBeNull(); // 10 px cells
    unmount();
    useEditor.getState().setTimelineZoom(2); // 20 px cells
    render(<Timeline />);
    expect(screen.getByTestId('ruler-frame-2')).toHaveStyle({ left: `${(1 / FPS) * 2 * PX_PER_SECOND}px` });
    expect(screen.queryByTestId('ruler-frame-11')).toBeNull(); // frame 11 = 1s, labelled as a second
    expect(screen.getByTestId('ruler-frame-12')).toBeInTheDocument();
  });

  it('zoomed out, second labels thin out instead of overlapping', () => {
    useEditor.getState().setTimelineZoom(0.25); // 25 px/s → every 2nd second
    render(<Timeline />);
    expect(screen.getByTestId('ruler-second-2')).toHaveStyle({ left: `${2 * 25}px` });
    expect(screen.queryByTestId('ruler-second-1')).toBeNull();
  });
});
