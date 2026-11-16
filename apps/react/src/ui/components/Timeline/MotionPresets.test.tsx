import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { sampleObject } from '@savig/engine';
import { Timeline } from './Timeline';
import { useEditor } from '../../store/store';

beforeEach(() => {
  useEditor.getState().newProject();
  useEditor.setState({ graphEditorOpen: false });
  useEditor.getState().setPresetLibrary([]);
});

describe('motion presets panel', () => {
  it('opens from the Timeline header, groups presets, and closes on Escape', async () => {
    render(<Timeline />);
    await userEvent.click(screen.getByTestId('presets-toggle'));
    const panel = screen.getByTestId('presets-panel');
    expect(panel).toHaveTextContent(/select an object/i);
    expect(screen.getByRole('group', { name: 'Entrance' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Exit' })).toBeInTheDocument();
    expect(screen.getByTestId('preset-pop-in')).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('presets-panel')).toBeNull();
  });

  it('one click animates the selected object from the playhead, with an optional duration', async () => {
    useEditor.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
    render(<Timeline />);
    await userEvent.click(screen.getByTestId('presets-toggle'));
    await userEvent.type(screen.getByLabelText('Preset duration in seconds'), '2');
    await userEvent.click(screen.getByTestId('preset-fade-in'));
    const o = useEditor.getState().history.present.objects[0];
    expect(o.tracks.opacity!.map((k) => [k.time, k.value])).toEqual([[0, 0], [2, 1]]);
    expect(sampleObject(o, 1).opacity).toBeGreaterThan(0);
    expect(useEditor.getState().toasts[0].message).toMatch(/Fade in applied/);
  });

  it('saves the selection motion to My presets, applies, renames and deletes it', async () => {
    const s = useEditor.getState();
    s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    s.seek(0);
    s.setProperty('x', 0);
    s.seek(1, { pastEnd: true });
    s.setProperty('x', 50);
    render(<Timeline />);
    await userEvent.click(screen.getByTestId('presets-toggle'));
    expect(screen.getByRole('group', { name: 'My presets' })).toHaveTextContent(/save its motion here/i);
    await userEvent.type(screen.getByLabelText('New preset name'), 'Nudge right');
    await userEvent.click(screen.getByTestId('preset-save'));
    const preset = useEditor.getState().presetLibrary[0];
    expect(preset.name).toBe('Nudge right');
    const chip = screen.getByTestId(`preset-${preset.id}`);
    expect(chip).toHaveTextContent('Nudge right');

    await userEvent.click(screen.getByRole('button', { name: 'Rename Nudge right' }));
    const field = screen.getByRole('textbox', { name: 'Rename Nudge right' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Scoot{Enter}');
    expect(useEditor.getState().presetLibrary[0].name).toBe('Scoot');
    expect(screen.getByTestId('presets-panel')).toBeInTheDocument(); // Enter in the field does not close it

    await userEvent.click(screen.getByRole('button', { name: 'Delete Scoot' }));
    expect(useEditor.getState().presetLibrary).toEqual([]);
  });

  it('explains why a selection without motion cannot be saved', async () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    render(<Timeline />);
    await userEvent.click(screen.getByTestId('presets-toggle'));
    await userEvent.click(screen.getByTestId('preset-save'));
    expect(useEditor.getState().toasts[0].message).toMatch(/transform keyframes/);
  });
});

describe('preset library and packs (spec 2026-11-16-preset-library)', () => {
  const preset = (id: string, name: string) => ({ id, name, category: 'custom' as const, duration: 1, tracks: { x: { mode: 'offset' as const, keys: [{ t: 0, v: 0 }, { t: 1, v: 9 }] } } });

  it('imports a pack file into My presets and reports duplicates', async () => {
    render(<Timeline />);
    await userEvent.click(screen.getByTestId('presets-toggle'));
    expect(screen.getByTestId('preset-export-pack')).toBeDisabled(); // nothing to export yet
    const file = new File([JSON.stringify({ format: 'savig-preset-pack', version: 1, presets: [preset('custom-a', 'Hop')] })], 'pack.json', { type: 'application/json' });
    await userEvent.upload(screen.getByTestId('preset-import-input'), file);
    await vi.waitFor(() => expect(useEditor.getState().presetLibrary.map((p) => p.name)).toEqual(['Hop']));
    expect(useEditor.getState().toasts[0].message).toMatch(/Added 1 preset/);
    expect(await screen.findByTestId('preset-custom-a')).toHaveTextContent('Hop');
    await userEvent.upload(screen.getByTestId('preset-import-input'), file);
    await vi.waitFor(() => expect(useEditor.getState().toasts[0].message).toMatch(/already in My presets/));
    await userEvent.upload(screen.getByTestId('preset-import-input'), new File(['not json'], 'x.json'));
    await vi.waitFor(() => expect(useEditor.getState().toasts[0].message).toMatch(/not a preset pack/));
  });

  it('shows presets from an older project file with an add-to-library button', async () => {
    const s = useEditor.getState();
    s.setProject({ ...s.history.present, motionPresets: [preset('custom-old', 'Legacy')] });
    render(<Timeline />);
    await userEvent.click(screen.getByTestId('presets-toggle'));
    await userEvent.click(screen.getByRole('button', { name: 'Add Legacy to my library' }));
    expect(useEditor.getState().presetLibrary.map((p) => p.id)).toEqual(['custom-old']);
    expect(screen.queryByRole('button', { name: 'Add Legacy to my library' })).toBeNull();
  });
});
