import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastHost } from './Toast';
import { useEditor } from '../../store/store';

beforeEach(() => useEditor.setState({ toasts: [] }));

it('renders toasts and dismisses on click', async () => {
  useEditor.getState().pushToast('error', 'Import failed');
  render(<ToastHost />);
  expect(screen.getByText('Import failed')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
  expect(screen.queryByText('Import failed')).not.toBeInTheDocument();
});
