// Frame-by-frame slice 3: the timeline frame strip (dots, spans, labels, drag, context menu) and
// the collapsed-by-default frame layer rows.
import { render, screen, fireEvent, within } from '@testing-library/react';
import { Timeline } from './Timeline';
import { useEditor } from '../../store/store';
import { PX_PER_SECOND } from './scale';
import { createFrameLayer, createProject, createSceneObject } from '@savig/engine';

const FPS = 10;
const f = (n: number) => n / FPS;
const cell = PX_PER_SECOND / FPS;
const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';

beforeEach(() => {
  const L = createFrameLayer({ id: 'L', name: 'Layer', zOrder: 1, keys: [{ id: 'a', time: 0 }, { id: 'b', time: f(3), label: 'blink' }], end: 1 });
  useEditor.getState().setProject({
    ...createProject({ fps: FPS, duration: 2, durationMode: 'manual' }),
    assets: [{ id: 'box', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 }],
    objects: [L, createSceneObject('box', { id: 'A', name: 'Drawing A', zOrder: 0, parentId: 'L', frameKeyId: 'a' })],
  });
});

const layer = () => useEditor.getState().history.present.objects.find((o) => o.id === 'L')!;

describe('frame strip', () => {
  it('draws a filled dot for a key with a drawing, a hollow one for a blank key, and the label', () => {
    render(<Timeline />);
    expect(screen.getByTestId('frame-key-a')).toHaveAttribute('data-blank', 'false');
    expect(screen.getByTestId('frame-key-b')).toHaveAttribute('data-blank', 'true');
    expect(screen.getByTestId('frame-key-b')).toHaveTextContent('blink');
    expect(screen.getByTestId('frame-span-a')).toHaveStyle({ left: '0px', width: `${3 * cell}px` });
    expect(screen.getByTestId('frame-end-L')).toHaveStyle({ left: `${PX_PER_SECOND}px` });
  });

  it('keeps the layer’s drawings collapsed until expanded, then shows the exposed one', () => {
    render(<Timeline />);
    expect(screen.queryByTestId('track-row-A')).toBeNull();
    fireEvent.click(screen.getByTestId('frame-toggle-L'));
    expect(screen.getByTestId('track-row-A')).toBeInTheDocument();
  });

  it('dragging a key dot moves the key, frame-snapped', () => {
    render(<Timeline />);
    const dot = screen.getByTestId('frame-key-b');
    fireEvent.pointerDown(dot, { clientX: 3 * cell, button: 0 });
    fireEvent.pointerMove(window, { clientX: 5 * cell + 2 });
    fireEvent.pointerUp(window, { clientX: 5 * cell + 2 });
    expect(layer().frames!.keys.find((k) => k.id === 'b')!.time).toBeCloseTo(f(5));
    expect(useEditor.getState().selectedObjectId).toBe('L');
  });

  it('right-click opens the frame menu at that cell; Insert Frame pushes later keys', () => {
    render(<Timeline />);
    fireEvent.contextMenu(screen.getByTestId('frame-strip-L'), { clientX: 1 * cell + 4 });
    expect(useEditor.getState().time).toBeCloseTo(f(1));
    const menu = screen.getByTestId('frame-menu');
    fireEvent.click(within(menu).getByText(/Insert Frame/));
    expect(layer().frames!.keys.map((k) => k.time)).toEqual([0, f(4)]);
    expect(screen.queryByTestId('frame-menu')).toBeNull();
  });

  it('labels the key under the cell from the menu', () => {
    render(<Timeline />);
    fireEvent.contextMenu(screen.getByTestId('frame-strip-L'), { clientX: 0 + 2 });
    const input = screen.getByLabelText('Frame label');
    fireEvent.change(input, { target: { value: 'start' } });
    fireEvent.submit(input.closest('form')!);
    expect(layer().frames!.keys.find((k) => k.id === 'a')!.label).toBe('start');
  });
});
