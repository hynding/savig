import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { SceneStrip } from './SceneStrip';
import { Stage } from '../Stage/Stage';
import { useEditor } from '../../store/store';
import { createProject, projectScenes } from '@savig/engine';
import * as thumbnailSvgModule from '../AssetPanel/thumbnailSvg';

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

  it('renders thumbnails as a data-URI <img>, not inlined SVG markup (task 2)', () => {
    render(<SceneStrip />);
    const tile = screen.getAllByRole('button', { name: /scene/i })[0];
    expect(tile.querySelector('svg')).toBeNull();
    const img = tile.querySelector('img')!;
    expect(img).toBeInTheDocument();
    expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  });

  it('MEMO pin: sceneThumbnailSvg is not recalled when an unrelated store field (time) changes', () => {
    // Multi-scene (not the single-scene default): projectScenes() returns the real, stable
    // `present.scenes` array elements here, so an unrelated field (time) leaves `scene` referentially
    // unchanged and useMemo can actually skip. (A single-scene project synthesizes a fresh scene
    // object literal on every projectScenes() call regardless of memoization — a separate, known gap.)
    useEditor.getState().addScene();
    const spy = vi.spyOn(thumbnailSvgModule, 'sceneThumbnailSvg');
    render(<SceneStrip />);
    const callsAfterMount = spy.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);
    act(() => { useEditor.getState().seek(1); }); // unrelated to scene/assets/meta -> no recompute
    expect(spy.mock.calls.length).toBe(callsAfterMount);
  });

  it('COLLISION-KILL pin: Stage + SceneStrip never share an element id (data-URI isolation)', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 30 });
    useEditor.getState().setVectorGradient('fill', {
      type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5,
      stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }],
    });
    const nodes = new Map<string, SVGGraphicsElement>();
    render(
      <>
        <Stage nodes={nodes} />
        <SceneStrip />
      </>,
    );
    // Before this task, the active scene's thumbnail duplicated the Stage's `savig-grad-<id>-fill`
    // id (both rendered the same object). Rendering thumbnails as <img> keeps their markup (and ids)
    // out of the live document entirely.
    const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    const tile = screen.getAllByRole('button', { name: /scene/i })[0];
    expect(tile.querySelector('svg')).toBeNull();
    expect(tile.querySelector('img')!.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  });
});
