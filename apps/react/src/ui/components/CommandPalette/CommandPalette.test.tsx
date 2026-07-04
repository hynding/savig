import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from './CommandPalette';
import { useEditor } from '../../store/store';
import type { CommandHost } from '@savig/ui-core';

const noopHost: CommandHost = {
  newProject: () => {}, openProject: () => {}, saveProject: () => {}, exportProject: () => {},
  openPalette: () => {}, openShortcuts: () => {}, openTemplates: () => {}, openGettingStarted: () => {}, closeOverlay: () => {},
};

const twoSelectedRects = () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 60, y: 0, width: 10, height: 10 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
};

beforeEach(() => {
  useEditor.getState().newProject();
});

it('renders a searchable dialog and filters commands', async () => {
  render(<CommandPalette host={noopHost} onClose={() => {}} />);
  expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
  const input = screen.getByLabelText('Command search');
  await userEvent.type(input, 'align');
  expect(screen.getByText('Align left')).toBeInTheDocument();
  expect(screen.queryByText('Undo')).toBeNull();
});

it('runs the highlighted command on Enter (Align left changes the project)', async () => {
  twoSelectedRects();
  const before = JSON.stringify(useEditor.getState().history.present.objects);
  let closed = false;
  render(<CommandPalette host={noopHost} onClose={() => { closed = true; }} />);
  const input = screen.getByLabelText('Command search');
  await userEvent.type(input, 'align left');
  fireEvent.keyDown(input, { key: 'Enter' });
  // The align ran (autoKey may write a keyframe rather than base) and the palette closed.
  expect(JSON.stringify(useEditor.getState().history.present.objects)).not.toBe(before);
  expect(closed).toBe(true);
});

it('does not run a disabled command', async () => {
  // Nothing selected -> Align left is disabled.
  let closed = false;
  render(<CommandPalette host={noopHost} onClose={() => { closed = true; }} />);
  const input = screen.getByLabelText('Command search');
  await userEvent.type(input, 'align left');
  const before = JSON.stringify(useEditor.getState().history.present.objects);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(JSON.stringify(useEditor.getState().history.present.objects)).toBe(before);
  expect(closed).toBe(false);
});

it('closes BEFORE running the command, so a command that opens another overlay is not clobbered', async () => {
  const order: string[] = [];
  const host = { ...noopHost, openTemplates: () => order.push('run') };
  render(<CommandPalette host={host} onClose={() => order.push('close')} />);
  const input = screen.getByLabelText('Command search');
  await userEvent.type(input, 'new from template');
  fireEvent.keyDown(input, { key: 'Enter' });
  // onClose (setOverlay(null)) must run first so the command's setOverlay('templates') wins the batch.
  expect(order).toEqual(['close', 'run']);
});

it('Escape closes', () => {
  let closed = false;
  render(<CommandPalette host={noopHost} onClose={() => { closed = true; }} />);
  fireEvent.keyDown(screen.getByLabelText('Command search'), { key: 'Escape' });
  expect(closed).toBe(true);
});
