import { render, screen, act } from '@testing-library/react';
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
