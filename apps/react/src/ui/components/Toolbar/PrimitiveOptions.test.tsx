import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PrimitiveOptions } from './PrimitiveOptions';
import { useEditor } from '../../store/store';

describe('PrimitiveOptions', () => {
  beforeEach(() => useEditor.getState().newProject());

  it('renders nothing for non-primitive tools', () => {
    useEditor.getState().setActiveTool('select');
    const { container } = render(<PrimitiveOptions />);
    expect(container).toBeEmptyDOMElement();
  });

  it('edits polygon sides when the polygon tool is active', () => {
    useEditor.getState().setActiveTool('polygon');
    render(<PrimitiveOptions />);
    const input = screen.getByLabelText('Sides');
    fireEvent.change(input, { target: { value: '7' } });
    expect(useEditor.getState().polygonSides).toBe(7);
  });

  it('edits star points and inner ratio when the star tool is active', () => {
    useEditor.getState().setActiveTool('star');
    render(<PrimitiveOptions />);
    fireEvent.change(screen.getByLabelText('Points'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Inner ratio'), { target: { value: '0.4' } });
    expect(useEditor.getState().starPoints).toBe(6);
    expect(useEditor.getState().starInnerRatio).toBeCloseTo(0.4, 6);
  });

  it('edits the corner radius for the polygon tool', () => {
    useEditor.getState().setActiveTool('polygon');
    render(<PrimitiveOptions />);
    fireEvent.change(screen.getByLabelText('Corner radius'), { target: { value: '12' } });
    expect(useEditor.getState().primitiveCornerRadius).toBe(12);
  });

  it('edits the corner radius for the star tool', () => {
    useEditor.getState().setActiveTool('star');
    render(<PrimitiveOptions />);
    fireEvent.change(screen.getByLabelText('Corner radius'), { target: { value: '5' } });
    expect(useEditor.getState().primitiveCornerRadius).toBe(5);
  });

  it('shows brush options and updates size + smoothing when the brush tool is active', () => {
    useEditor.getState().setActiveTool('brush');
    render(<PrimitiveOptions />);
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Smoothing'), { target: { value: '0.8' } });
    expect(useEditor.getState().brushSize).toBe(12);
    expect(useEditor.getState().brushSmoothing).toBeCloseTo(0.8, 6);
  });

  it('edits taper in/out (0-50% range, mapped to the 0-0.5 fraction) for the brush tool', () => {
    useEditor.getState().setActiveTool('brush');
    render(<PrimitiveOptions />);
    fireEvent.change(screen.getByLabelText('Taper in'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Taper out'), { target: { value: '35' } });
    expect(useEditor.getState().brushTaperIn).toBeCloseTo(0.2, 6);
    expect(useEditor.getState().brushTaperOut).toBeCloseTo(0.35, 6);
  });

  it('displays taper in/out as their current percentage', () => {
    useEditor.getState().setActiveTool('brush');
    useEditor.getState().setBrushTaperIn(0.15);
    useEditor.getState().setBrushTaperOut(0.4);
    render(<PrimitiveOptions />);
    expect(screen.getByLabelText('Taper in')).toHaveValue('15');
    expect(screen.getByLabelText('Taper out')).toHaveValue('40');
  });

  it('toggles pressure via the Pressure checkbox for the brush tool', () => {
    useEditor.getState().setActiveTool('brush');
    render(<PrimitiveOptions />);
    const checkbox = screen.getByLabelText('Pressure');
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(useEditor.getState().brushUsePressure).toBe(true);
    fireEvent.click(checkbox);
    expect(useEditor.getState().brushUsePressure).toBe(false);
  });
});
