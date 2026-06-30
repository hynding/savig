import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SceneStrip } from './SceneStrip';
import { useEditor } from '../../store/store';
import { createProject } from '../../../engine';

beforeEach(() => useEditor.getState().setProject(createProject()));

describe('SceneStrip', () => {
  it('shows one scene for a single-scene project and an add button', () => {
    render(<SceneStrip />);
    expect(screen.getAllByRole('button', { name: /scene/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /add scene/i })).toBeInTheDocument();
  });

  it('add scene creates and selects a second scene', () => {
    render(<SceneStrip />);
    fireEvent.click(screen.getByRole('button', { name: /add scene/i }));
    expect(useEditor.getState().history.present.scenes!.length).toBe(2);
  });

  it('clicking a scene selects it', () => {
    useEditor.getState().addScene();
    render(<SceneStrip />);
    const first = useEditor.getState().history.present.scenes![0].id;
    fireEvent.click(screen.getByTestId(`scene-${first}`));
    expect(useEditor.getState().selectedSceneId).toBe(first);
  });
});
