import { render, screen, fireEvent } from '@testing-library/react';
import { ShortcutsSheet } from './ShortcutsSheet';

it('renders category groups and a known binding row', () => {
  render(<ShortcutsSheet onClose={() => {}} />);
  expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  expect(screen.getByText('Edit')).toBeInTheDocument();
  expect(screen.getByText('Undo')).toBeInTheDocument();
});

it('Escape and the close button both close', () => {
  let closed = 0;
  const { rerender } = render(<ShortcutsSheet onClose={() => { closed += 1; }} />);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(closed).toBe(1);
  rerender(<ShortcutsSheet onClose={() => { closed += 1; }} />);
  fireEvent.click(screen.getByLabelText('Close'));
  expect(closed).toBe(2);
});
