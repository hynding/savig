import { afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { useEditor } from './store/store';

const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

beforeEach(() => useEditor.getState().newProject());
afterEach(() => {
  delete document.documentElement.dataset.theme;
});

it('renders all five regions', () => {
  render(<App />);
  for (const name of [/toolbar/i, /assets/i, /stage/i, /inspector/i, /timeline/i]) {
    expect(screen.getByRole('region', { name })).toBeInTheDocument();
  }
});

it('end-to-end: add object, key a property, see it on the timeline', async () => {
  render(<App />);
  act(() => {
    useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
    useEditor.getState().addObject('a');
    useEditor.getState().seek(1);
  });
  const x = await screen.findByLabelText('x');
  await userEvent.clear(x);
  await userEvent.type(x, '80');
  await userEvent.tab();
  const id = useEditor.getState().history.present.objects[0].id;
  expect(screen.getByTestId(`keyframe-${id}-x-1`)).toBeInTheDocument();
});

it('theme toggle flips data-theme', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /theme/i }));
  expect(document.documentElement.dataset.theme).toBe('light');
});
