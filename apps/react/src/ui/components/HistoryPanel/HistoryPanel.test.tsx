import { act, fireEvent, render, screen } from '@testing-library/react';
import { HistoryPanel } from './HistoryPanel';
import { useEditor } from '../../store/store';

beforeEach(() => {
  useEditor.getState().newProject();
  if (useEditor.getState().historyPanelOpen) useEditor.getState().toggleHistoryPanel();
});

const rect = () => useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });

it('is collapsed by default and opens from its header', () => {
  render(<HistoryPanel />);
  expect(screen.queryByTestId('history-row-0')).toBeNull();
  fireEvent.click(screen.getByTestId('history-toggle'));
  expect(screen.getByTestId('history-row-0').textContent).toBe('New document');
  expect(screen.getByTestId('history-toggle').getAttribute('aria-expanded')).toBe('true');
});

it('lists named steps and jumps back and forward on click', () => {
  useEditor.getState().toggleHistoryPanel();
  rect();
  useEditor.getState().setProperty('rotation', 30);
  render(<HistoryPanel />);
  expect(screen.getByTestId('history-row-1').textContent).toBe('Draw rect');
  expect(screen.getByTestId('history-row-2').textContent).toBe('Rotate');
  expect(screen.getByTestId('history-row-2').getAttribute('data-state')).toBe('current');
  expect(screen.getByTestId('history-count').textContent).toBe('2');

  fireEvent.click(screen.getByTestId('history-row-0'));
  expect(useEditor.getState().history.present.objects).toHaveLength(0);
  expect(screen.getByTestId('history-row-2').getAttribute('data-state')).toBe('future');

  fireEvent.click(screen.getByTestId('history-row-2'));
  expect(useEditor.getState().history.present.objects).toHaveLength(1);
  expect(screen.getByTestId('history-row-2').getAttribute('aria-current')).toBe('step');
});

it('undo and redo buttons follow what is possible', () => {
  render(<HistoryPanel />);
  const undo = screen.getByTestId('history-undo') as HTMLButtonElement;
  const redo = screen.getByTestId('history-redo') as HTMLButtonElement;
  expect(undo.disabled).toBe(true);
  act(() => rect());
  expect(undo.disabled).toBe(false);
  fireEvent.click(undo);
  expect(redo.disabled).toBe(false);
  fireEvent.click(redo);
  expect(useEditor.getState().history.present.objects).toHaveLength(1);
});
