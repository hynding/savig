// RTL tests for the object-level Behaviors section (mounted inside Inspector.tsx's single-object
// branch). Drives the real store through the rendered `<Inspector />` — mirrors Inspector.test.tsx's
// existing pattern (no mocking, assert on `useEditor.getState()` after each interaction).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Inspector } from './Inspector';
import { useEditor } from '../../store/store';

const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';

beforeEach(() => {
  useEditor.getState().newProject();
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
  useEditor.getState().addObject('a');
});

it('add-behavior adds a click behavior with empty actions on the selected object', async () => {
  render(<Inspector />);
  await userEvent.click(screen.getByTestId('add-behavior'));
  const objId = useEditor.getState().selectedObjectId!;
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === objId)!;
  expect(obj.behaviors).toHaveLength(1);
  expect(obj.behaviors![0].event).toBe('click');
  expect(obj.behaviors![0].actions).toEqual([]);
});

it('the event select on an object behavior is scoped to pointer kinds only', async () => {
  render(<Inspector />);
  await userEvent.click(screen.getByTestId('add-behavior'));
  const objId = useEditor.getState().selectedObjectId!;
  const behaviorId = useEditor.getState().history.present.objects.find((o) => o.id === objId)!.behaviors![0].id;
  const select = screen.getByTestId(`behavior-event-${behaviorId}`) as HTMLSelectElement;
  const options = Array.from(select.options).map((o) => o.value);
  expect(options).toEqual(['click', 'pointerdown', 'pointerup', 'hoverEnter', 'hoverLeave']);
  // No key/scene fields for a pointer event.
  expect(screen.queryByTestId(`behavior-key-${behaviorId}`)).not.toBeInTheDocument();
  expect(screen.queryByTestId(`behavior-scene-${behaviorId}`)).not.toBeInTheDocument();
});

it('add-action appends a default action; removing all behaviors clears obj.behaviors', async () => {
  render(<Inspector />);
  await userEvent.click(screen.getByTestId('add-behavior'));
  const objId = useEditor.getState().selectedObjectId!;
  const behaviorId = useEditor.getState().history.present.objects.find((o) => o.id === objId)!.behaviors![0].id;
  await userEvent.click(screen.getByTestId(`add-action-${behaviorId}`));
  expect(
    useEditor.getState().history.present.objects.find((o) => o.id === objId)!.behaviors![0].actions,
  ).toEqual([{ kind: 'play' }]);

  await userEvent.click(screen.getByTestId(`remove-behavior-${behaviorId}`));
  expect(useEditor.getState().history.present.objects.find((o) => o.id === objId)!.behaviors).toBeUndefined();
});

it('changing action kind exposes the right arg inputs (gotoScene -> sceneId select)', async () => {
  render(<Inspector />);
  await userEvent.click(screen.getByTestId('add-behavior'));
  const objId = useEditor.getState().selectedObjectId!;
  const behaviorId = useEditor.getState().history.present.objects.find((o) => o.id === objId)!.behaviors![0].id;
  await userEvent.click(screen.getByTestId(`add-action-${behaviorId}`));
  await userEvent.selectOptions(screen.getByTestId(`action-kind-${behaviorId}-0`), 'gotoScene');
  const sceneSelect = screen.getByTestId(`action-arg-${behaviorId}-0-sceneId`) as HTMLSelectElement;
  expect(sceneSelect.tagName).toBe('SELECT');
  expect(
    useEditor.getState().history.present.objects.find((o) => o.id === objId)!.behaviors![0].actions[0].kind,
  ).toBe('gotoScene');
});

it('an invalid expression arg shows an inline expr-error with a position, and still commits on blur', async () => {
  render(<Inspector />);
  await userEvent.click(screen.getByTestId('add-behavior'));
  const objId = useEditor.getState().selectedObjectId!;
  const behaviorId = useEditor.getState().history.present.objects.find((o) => o.id === objId)!.behaviors![0].id;
  await userEvent.click(screen.getByTestId(`add-action-${behaviorId}`));
  await userEvent.selectOptions(screen.getByTestId(`action-kind-${behaviorId}-0`), 'setOpacity');

  const valueInput = screen.getByTestId(`action-arg-${behaviorId}-0-value`);
  await userEvent.type(valueInput, '+'); // unparseable — not even a valid primary expression
  const err = screen.getByTestId(`expr-error-${behaviorId}-0`);
  expect(err.textContent).toMatch(/@\d+$/);

  await userEvent.tab();
  expect(
    useEditor.getState().history.present.objects.find((o) => o.id === objId)!.behaviors![0].actions[0].args?.value,
  ).toBe('+');
});

it('a valid expression arg clears the expr-error', async () => {
  render(<Inspector />);
  await userEvent.click(screen.getByTestId('add-behavior'));
  const objId = useEditor.getState().selectedObjectId!;
  const behaviorId = useEditor.getState().history.present.objects.find((o) => o.id === objId)!.behaviors![0].id;
  await userEvent.click(screen.getByTestId(`add-action-${behaviorId}`));
  await userEvent.selectOptions(screen.getByTestId(`action-kind-${behaviorId}-0`), 'setOpacity');

  const valueInput = screen.getByTestId(`action-arg-${behaviorId}-0-value`);
  await userEvent.type(valueInput, '+');
  expect(screen.getByTestId(`expr-error-${behaviorId}-0`)).toBeInTheDocument();
  await userEvent.clear(valueInput);
  await userEvent.type(valueInput, '0.5');
  expect(screen.queryByTestId(`expr-error-${behaviorId}-0`)).not.toBeInTheDocument();
});

it('pressing Enter in an expression field commits exactly ONE undo entry (regression: no double-commit)', async () => {
  render(<Inspector />);
  await userEvent.click(screen.getByTestId('add-behavior'));
  const objId = useEditor.getState().selectedObjectId!;
  const behaviorId = useEditor.getState().history.present.objects.find((o) => o.id === objId)!.behaviors![0].id;
  await userEvent.click(screen.getByTestId(`add-action-${behaviorId}`));
  await userEvent.selectOptions(screen.getByTestId(`action-kind-${behaviorId}-0`), 'setOpacity');

  const before = useEditor.getState().history.past.length;
  const valueInput = screen.getByTestId(`action-arg-${behaviorId}-0-value`);
  await userEvent.type(valueInput, '0.5{Enter}');

  // Exactly one new history entry for this single edit — a double-commit (Enter's onKeyDown
  // calling commit() AND the resulting blur's onBlur calling it again with the stale-closure
  // `value`) would push two.
  expect(useEditor.getState().history.past.length).toBe(before + 1);
  expect(
    useEditor.getState().history.present.objects.find((o) => o.id === objId)!.behaviors![0].actions[0].args?.value,
  ).toBe('0.5');

  // One undo fully restores the pre-edit state (the arg was never set).
  useEditor.getState().undo();
  expect(
    useEditor.getState().history.present.objects.find((o) => o.id === objId)!.behaviors![0].actions[0].args?.value,
  ).toBeUndefined();
});
