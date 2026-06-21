import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EasingEditor, curveSamples } from './EasingEditor';
import type { CubicBezierEasing } from '../../../engine';

describe('curveSamples', () => {
  it('plots the real applyEasing output (linear vs easeIn differ at t=0.5)', () => {
    const lin = curveSamples('linear', 4).find((p) => p.t === 0.5)!;
    const easeIn = curveSamples('easeIn', 4).find((p) => p.t === 0.5)!;
    expect(lin.y).toBeCloseTo(0.5, 5);
    expect(easeIn.y).toBeCloseTo(0.25, 5); // t*t at 0.5
  });
});

describe('EasingEditor', () => {
  it('marks the preset matching value as pressed and has no handles for a named easing', () => {
    render(<EasingEditor value="easeOut" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'easeOut' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('clicking a named preset calls onChange with that name', async () => {
    const onChange = vi.fn();
    render(<EasingEditor value="linear" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'easeIn' }));
    expect(onChange).toHaveBeenCalledWith('easeIn');
  });

  it('clicking custom seeds a cubicBezier and reveals two handles', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<EasingEditor value="linear" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'custom' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'cubicBezier' }),
    );
    rerender(
      <EasingEditor
        value={{ type: 'cubicBezier', p1: 0.42, p2: 0, p3: 0.58, p4: 1 }}
        onChange={onChange}
      />,
    );
    expect(screen.getAllByRole('slider')).toHaveLength(2);
  });

  it('dragging control point 1 calls onChange with clamped params', () => {
    const onChange = vi.fn();
    const value: CubicBezierEasing = { type: 'cubicBezier', p1: 0.42, p2: 0, p3: 0.58, p4: 1 };
    const { container } = render(<EasingEditor value={value} onChange={onChange} />);
    const svg = container.querySelector('svg')!;
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 120, height: 180, right: 120, bottom: 180, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
    const handle = screen.getByRole('slider', { name: 'ease control point 1' });
    fireEvent.pointerDown(handle, { pointerId: 1 });
    // clientX=60 -> x=0.5 ; clientY=30 (PAD) -> y=1.0
    fireEvent.pointerMove(handle, { pointerId: 1, buttons: 1, clientX: 60, clientY: 30 });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'cubicBezier', p1: 0.5, p2: 1, p3: 0.58, p4: 1 }),
    );
  });

  it('arrow keys nudge a focused handle', () => {
    const onChange = vi.fn();
    const value: CubicBezierEasing = { type: 'cubicBezier', p1: 0.4, p2: 0, p3: 0.58, p4: 1 };
    render(<EasingEditor value={value} onChange={onChange} />);
    const handle = screen.getByRole('slider', { name: 'ease control point 1' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ p1: expect.closeTo(0.42, 5) }));
  });

  it('clamps an out-of-range nudge to the param bounds', () => {
    const onChange = vi.fn();
    const value: CubicBezierEasing = { type: 'cubicBezier', p1: 0.99, p2: -0.48, p3: 0.58, p4: 1 };
    render(<EasingEditor value={value} onChange={onChange} />);
    const h1 = screen.getByRole('slider', { name: 'ease control point 1' });
    fireEvent.keyDown(h1, { key: 'ArrowRight' }); // 0.99 + 0.02 -> clamp to 1.0
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ p1: 1 }));
    fireEvent.keyDown(h1, { key: 'ArrowDown' }); // -0.48 - 0.02 -> clamp to -0.5
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ p2: expect.closeTo(-0.5, 5) }));
  });

  it('shows the inert hint when inert', () => {
    render(<EasingEditor value="linear" onChange={() => {}} inert />);
    expect(screen.getByText(/segment into the next keyframe/i)).toBeInTheDocument();
  });
});
