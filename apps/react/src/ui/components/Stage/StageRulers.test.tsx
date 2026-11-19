import { render, screen, act, fireEvent } from '@testing-library/react';
import { StageRulers } from './StageRulers';
import { useEditor } from '../../store/store';

beforeEach(() => {
  act(() => {
    useEditor.getState().newProject();
    useEditor.setState({ rulersVisible: false, guidesVisible: true, guidesLocked: false, activeTool: 'select', previewMode: false });
  });
});

it('shows rulers only when turned on', () => {
  const { rerender } = render(<StageRulers />);
  expect(screen.queryByTestId('ruler-top')).not.toBeInTheDocument();
  act(() => useEditor.getState().toggleRulers());
  rerender(<StageRulers />);
  expect(screen.getByTestId('ruler-top')).toBeInTheDocument();
  expect(screen.getByTestId('ruler-left')).toBeInTheDocument();
});

it('draws guides with drag handles, hides them when hidden, locked or previewing', () => {
  act(() => {
    useEditor.getState().addGuide('x', 120);
    useEditor.getState().addGuide('y', 40);
  });
  const { rerender } = render(<StageRulers />);
  expect(screen.getByTestId('guide-x-0')).toHaveAttribute('data-pos', '120');
  expect(screen.getByTestId('guide-y-1')).toHaveAttribute('data-pos', '40');
  expect(screen.getByTestId('guide-hit-0')).toBeInTheDocument();

  act(() => useEditor.getState().toggleGuidesLocked());
  rerender(<StageRulers />);
  expect(screen.getByTestId('guide-x-0')).toBeInTheDocument();
  expect(screen.queryByTestId('guide-hit-0')).not.toBeInTheDocument();

  act(() => useEditor.getState().toggleGuides());
  rerender(<StageRulers />);
  expect(screen.queryByTestId('guide-x-0')).not.toBeInTheDocument();

  act(() => useEditor.setState({ guidesVisible: true, previewMode: true }));
  rerender(<StageRulers />);
  expect(screen.queryByTestId('guide-x-0')).not.toBeInTheDocument();
});

it('double-clicking a guide opens a position field; Enter moves it, Escape cancels', () => {
  act(() => useEditor.getState().addGuide('x', 120));
  render(<StageRulers />);
  fireEvent.doubleClick(screen.getByTestId('guide-hit-0'));
  const input = screen.getByTestId('guide-pos-input');
  expect(input).toHaveValue(120);
  fireEvent.change(input, { target: { value: '250' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(useEditor.getState().history.present.guides).toEqual([{ axis: 'x', pos: 250 }]);
  expect(screen.queryByTestId('guide-pos-input')).not.toBeInTheDocument();

  fireEvent.doubleClick(screen.getByTestId('guide-hit-0'));
  fireEvent.change(screen.getByTestId('guide-pos-input'), { target: { value: '9' } });
  fireEvent.keyDown(screen.getByTestId('guide-pos-input'), { key: 'Escape' });
  expect(useEditor.getState().history.present.guides![0].pos).toBe(250);
});
