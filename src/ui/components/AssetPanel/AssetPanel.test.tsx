import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssetPanel } from './AssetPanel';
import { ToastHost } from '../Toast/Toast';
import { useEditor } from '../../store/store';

beforeEach(() => useEditor.getState().newProject());

const svgText =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

it('imports an SVG file and lists it', async () => {
  render(<AssetPanel />);
  const file = new File([svgText], 'box.svg', { type: 'image/svg+xml' });
  await userEvent.upload(screen.getByLabelText(/import svg/i), file);
  expect(await screen.findByText('box.svg')).toBeInTheDocument();
  expect(useEditor.getState().history.present.assets).toHaveLength(1);
});

it('clicking a listed SVG asset adds an instance to the stage', async () => {
  useEditor.getState().addAsset({
    id: 'a', kind: 'svg', name: 'box.svg', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10,
  });
  render(<AssetPanel />);
  await userEvent.click(screen.getByRole('button', { name: /box\.svg/i }));
  expect(useEditor.getState().history.present.objects).toHaveLength(1);
});

it('shows a toast on malformed SVG import', async () => {
  render(
    <>
      <AssetPanel />
      <ToastHost />
    </>,
  );
  const bad = new File(['not svg'], 'bad.svg', { type: 'image/svg+xml' });
  await userEvent.upload(screen.getByLabelText(/import svg/i), bad);
  expect(await screen.findByRole('status')).toHaveTextContent(/bad\.svg/i);
});
