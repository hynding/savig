// RTL tests for the project-level Interactions panel (mounted inside Inspector.tsx's
// `vm.kind === 'empty'` branch). Same real-store pattern as Inspector.test.tsx.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Inspector } from './Inspector';
import { useEditor } from '../../store/store';

beforeEach(() => {
  useEditor.getState().newProject();
  useEditor.getState().selectObject(null);
});

describe('variables', () => {
  it('add-variable with a numeric initial infers a number', async () => {
    render(<Inspector />);
    await userEvent.type(screen.getByLabelText('new variable name'), 'score');
    await userEvent.type(screen.getByLabelText('new variable initial'), '42');
    await userEvent.click(screen.getByTestId('add-variable'));
    expect(useEditor.getState().history.present.interactions?.variables).toEqual([
      { name: 'score', initial: 42 },
    ]);
    expect(screen.getByTestId('variable-name-score')).toBeInTheDocument();
    expect(screen.getByTestId('variable-initial-score')).toBeInTheDocument();
  });

  it('add-variable with "true"/"false" infers a boolean', async () => {
    render(<Inspector />);
    await userEvent.type(screen.getByLabelText('new variable name'), 'won');
    await userEvent.type(screen.getByLabelText('new variable initial'), 'true');
    await userEvent.click(screen.getByTestId('add-variable'));
    expect(useEditor.getState().history.present.interactions?.variables).toEqual([
      { name: 'won', initial: true },
    ]);
  });

  it('add-variable with a non-numeric, non-boolean initial infers a string', async () => {
    render(<Inspector />);
    await userEvent.type(screen.getByLabelText('new variable name'), 'label');
    await userEvent.type(screen.getByLabelText('new variable initial'), 'hello');
    await userEvent.click(screen.getByTestId('add-variable'));
    expect(useEditor.getState().history.present.interactions?.variables).toEqual([
      { name: 'label', initial: 'hello' },
    ]);
  });

  it('editing an existing variable\'s initial value commits via updateVariable on blur', async () => {
    useEditor.getState().addVariable('score', 0);
    render(<Inspector />);
    const initialInput = screen.getByTestId('variable-initial-score');
    await userEvent.clear(initialInput);
    await userEvent.type(initialInput, '7');
    await userEvent.tab();
    expect(useEditor.getState().history.present.interactions?.variables).toEqual([
      { name: 'score', initial: 7 },
    ]);
  });

  it('removing a variable drops it (and interactions entirely once empty)', async () => {
    useEditor.getState().addVariable('score', 0);
    render(<Inspector />);
    await userEvent.click(screen.getByLabelText('remove variable score'));
    expect(useEditor.getState().history.present.interactions).toBeUndefined();
  });
});

describe('global handlers', () => {
  it('add-behavior on the project creates a global handler defaulting to the first global event kind', async () => {
    render(<Inspector />);
    await userEvent.click(screen.getByTestId('add-behavior'));
    const handlers = useEditor.getState().history.present.interactions!.handlers!;
    expect(handlers).toHaveLength(1);
    expect(handlers[0].event).toBe('keydown');
  });

  it('the event select on a global handler is scoped to global kinds only', async () => {
    render(<Inspector />);
    await userEvent.click(screen.getByTestId('add-behavior'));
    const handlerId = useEditor.getState().history.present.interactions!.handlers![0].id;
    const select = screen.getByTestId(`behavior-event-${handlerId}`) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(['keydown', 'keyup', 'sceneStart', 'sceneEnd', 'tick']);
  });

  it('a keydown global handler shows a key field that commits on blur', async () => {
    render(<Inspector />);
    await userEvent.click(screen.getByTestId('add-behavior'));
    const handlerId = useEditor.getState().history.present.interactions!.handlers![0].id;
    const keyInput = screen.getByTestId(`behavior-key-${handlerId}`);
    await userEvent.type(keyInput, 'ArrowLeft');
    await userEvent.tab();
    expect(useEditor.getState().history.present.interactions!.handlers![0].key).toBe('ArrowLeft');
  });

  it('a sceneStart handler shows a sceneId select sourced from project scenes', async () => {
    render(<Inspector />);
    await userEvent.click(screen.getByTestId('add-behavior'));
    const handlerId = useEditor.getState().history.present.interactions!.handlers![0].id;
    await userEvent.selectOptions(screen.getByTestId(`behavior-event-${handlerId}`), 'sceneStart');
    const sceneSelect = screen.getByTestId(`behavior-scene-${handlerId}`) as HTMLSelectElement;
    // The implicit single scene is always offered, plus the blank "every scene" option.
    expect(sceneSelect.options.length).toBeGreaterThanOrEqual(2);
  });

  it('a global handler action targeting an object shows targetId as required', async () => {
    useEditor.getState().addAsset({
      id: 'a',
      kind: 'svg',
      name: 'box',
      normalizedContent: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
      viewBox: '0 0 10 10',
      width: 10,
      height: 10,
    });
    useEditor.getState().addObject('a');
    const targetId = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObject(null);
    render(<Inspector />);
    await userEvent.click(screen.getByTestId('add-behavior'));
    const handlerId = useEditor.getState().history.present.interactions!.handlers![0].id;
    await userEvent.click(screen.getByTestId(`add-action-${handlerId}`));
    await userEvent.selectOptions(screen.getByTestId(`action-kind-${handlerId}-0`), 'show');
    const targetSelect = screen.getByTestId(`action-arg-${handlerId}-0-targetId`) as HTMLSelectElement;
    expect(targetSelect.options[0].textContent).toMatch(/required/i);
    await userEvent.selectOptions(targetSelect, targetId);
    expect(
      useEditor.getState().history.present.interactions!.handlers![0].actions[0].args?.targetId,
    ).toBe(targetId);
  });
});
