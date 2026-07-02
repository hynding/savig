import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TransportControls } from './TransportControls';
import { useEditor } from '../../store/store';

beforeEach(() => useEditor.getState().newProject());

it('toggles play/pause', async () => {
  render(<TransportControls />);
  await userEvent.click(screen.getByRole('button', { name: /play/i }));
  expect(useEditor.getState().playing).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: /pause/i }));
  expect(useEditor.getState().playing).toBe(false);
});

it('toggles loop', async () => {
  render(<TransportControls />);
  await userEvent.click(screen.getByRole('button', { name: /loop/i }));
  expect(useEditor.getState().history.present.meta.loop).toBe(true);
});

it('shows the playhead time', () => {
  useEditor.setState({ time: 5.2 });
  render(<TransportControls />);
  expect(screen.getByText(/00:05\.2/)).toBeInTheDocument();
});
