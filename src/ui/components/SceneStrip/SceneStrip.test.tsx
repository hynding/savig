import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SceneStrip } from './SceneStrip';
import { useEditor } from '../../store/store';
import { createProject, projectScenes } from '@savig/engine';

beforeEach(() => useEditor.getState().setProject(createProject()));

describe('SceneStrip', () => {
  it('shows one scene for a single-scene project and an add button', () => {
    render(<SceneStrip />);
    expect(screen.getAllByRole('button', { name: /scene/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /add scene/i })).toBeInTheDocument();
    // single-scene mode must hide per-tile controls (regression guard)
    expect(screen.queryByLabelText('Scene duration')).toBeNull();
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
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

  it('Escape cancels rename without committing the new name', () => {
    render(<SceneStrip />);
    const originalName = projectScenes(useEditor.getState().history.present)[0].name;
    fireEvent.doubleClick(screen.getByText(originalName));
    const input = screen.getByLabelText('Scene name');
    fireEvent.change(input, { target: { value: 'Discarded Name' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByLabelText('Scene name')).toBeNull();
    expect(projectScenes(useEditor.getState().history.present)[0].name).toBe(originalName);
  });

  it('a transition picker on a non-first scene sets the transition', () => {
    useEditor.getState().addScene();
    render(<SceneStrip />);
    const second = useEditor.getState().history.present.scenes![1].id;
    const tile = screen.getByTestId(`scene-${second}`).closest('[role="listitem"]')!;
    fireEvent.change(within(tile as HTMLElement).getByLabelText('Transition'), { target: { value: 'crossfade' } });
    expect(useEditor.getState().history.present.scenes!.find((s) => s.id === second)!.transitionIn)
      .toMatchObject({ kind: 'crossfade' });
  });

  it('the first scene has no transition picker', () => {
    useEditor.getState().addScene();
    render(<SceneStrip />);
    const first = useEditor.getState().history.present.scenes![0].id;
    const tile = screen.getByTestId(`scene-${first}`).closest('[role="listitem"]')!;
    expect(within(tile as HTMLElement).queryByLabelText('Transition')).toBeNull();
  });
});
