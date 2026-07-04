import { render, screen, fireEvent, act } from '@testing-library/react';
import { GettingStarted } from './GettingStarted';
import { useEditor } from '../../store/store';

beforeEach(() => {
  useEditor.getState().newProject();
});

it('renders the checklist reflecting the store, updating live', () => {
  const { rerender } = render(<GettingStarted onDismiss={() => {}} />);
  expect(screen.getByLabelText('Getting started')).toBeInTheDocument();
  // Blank project: "Draw a shape" not done.
  expect(screen.getByText('Draw a shape').closest('li')).toHaveAttribute('data-done', 'false');
  // Draw one → it checks off.
  act(() => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  });
  rerender(<GettingStarted onDismiss={() => {}} />);
  expect(screen.getByText('Draw a shape').closest('li')).toHaveAttribute('data-done', 'true');
});

it('Dismiss invokes onDismiss', () => {
  const onDismiss = vi.fn();
  render(<GettingStarted onDismiss={onDismiss} />);
  fireEvent.click(screen.getByLabelText('Dismiss getting started'));
  expect(onDismiss).toHaveBeenCalledOnce();
});

it('shows the congrats line when all milestones are met', () => {
  const a = (() => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    return useEditor.getState().selectedObjectId!;
  })();
  useEditor.getState().seek(0);
  useEditor.getState().setProperty('x', 42);
  useEditor.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  useEditor.getState().groupSelected();
  render(<GettingStarted onDismiss={() => {}} />);
  expect(screen.getByText(/got the basics/i)).toBeInTheDocument();
});
