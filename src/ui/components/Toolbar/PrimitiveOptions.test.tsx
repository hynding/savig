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
});
