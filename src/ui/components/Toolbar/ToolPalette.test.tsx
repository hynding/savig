import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolPalette } from './ToolPalette';
import { useEditor } from '../../store/store';

beforeEach(() => useEditor.getState().newProject());

describe('ToolPalette', () => {
  it('reflects and sets the active tool', async () => {
    render(<ToolPalette />);
    const rect = screen.getByRole('button', { name: 'Rectangle' });
    expect(rect).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(rect);
    expect(rect).toHaveAttribute('aria-pressed', 'true');
    expect(useEditor.getState().activeTool).toBe('rect');
  });

  it('renders pen and node tools and activates them on click', async () => {
    render(<ToolPalette />);
    await userEvent.click(screen.getByRole('button', { name: 'Pen' }));
    expect(useEditor.getState().activeTool).toBe('pen');
    await userEvent.click(screen.getByRole('button', { name: 'Node' }));
    expect(useEditor.getState().activeTool).toBe('node');
  });

  it('activates primitive tools from the palette', async () => {
    render(<ToolPalette />);
    await userEvent.click(screen.getByRole('button', { name: 'Polygon' }));
    expect(useEditor.getState().activeTool).toBe('polygon');
    await userEvent.click(screen.getByRole('button', { name: 'Star' }));
    expect(useEditor.getState().activeTool).toBe('star');
    await userEvent.click(screen.getByRole('button', { name: 'Line' }));
    expect(useEditor.getState().activeTool).toBe('line');
  });

  it('selects the brush tool', async () => {
    render(<ToolPalette />);
    await userEvent.click(screen.getByRole('button', { name: 'Brush' }));
    expect(useEditor.getState().activeTool).toBe('brush');
  });
});
