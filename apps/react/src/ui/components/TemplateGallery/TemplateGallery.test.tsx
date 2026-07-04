import { render, screen, fireEvent } from '@testing-library/react';
import { TemplateGallery } from './TemplateGallery';
import { useEditor } from '../../store/store';
import { templates } from '@savig/core';

beforeEach(() => {
  useEditor.getState().newProject();
});

it('renders a card per template with title and description', () => {
  render(<TemplateGallery onClose={() => {}} />);
  expect(screen.getByRole('dialog', { name: 'Template gallery' })).toBeInTheDocument();
  for (const t of templates) {
    expect(screen.getByText(t.title)).toBeInTheDocument();
    expect(screen.getByText(t.description)).toBeInTheDocument();
  }
});

it('loading a template replaces the project and closes', () => {
  const first = templates[0];
  let closed = false;
  render(<TemplateGallery onClose={() => { closed = true; }} />);
  fireEvent.click(screen.getByText(first.title));
  expect(useEditor.getState().history.present.meta.name).toBe(first.build().meta.name);
  expect(useEditor.getState().history.present.objects.length).toBeGreaterThan(0);
  expect(closed).toBe(true);
});

it('Escape and close button both close', () => {
  let closed = 0;
  const { rerender } = render(<TemplateGallery onClose={() => { closed += 1; }} />);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(closed).toBe(1);
  rerender(<TemplateGallery onClose={() => { closed += 1; }} />);
  fireEvent.click(screen.getByLabelText('Close'));
  expect(closed).toBe(2);
});
