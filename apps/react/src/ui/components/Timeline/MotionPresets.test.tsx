import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { sampleObject } from '@savig/engine';
import { Timeline } from './Timeline';
import { useEditor } from '../../store/store';

beforeEach(() => {
  useEditor.getState().newProject();
  useEditor.setState({ graphEditorOpen: false });
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
});
