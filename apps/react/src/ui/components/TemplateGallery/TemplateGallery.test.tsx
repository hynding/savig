import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
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

// Loading a template permanently replaces the current project (and, one debounce later, its
// autosave) — so a project with real content asks first. A pristine project loads silently.
describe('replace confirmation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('asks for confirmation when the current project has objects, and keeps it on cancel', () => {
    useEditor.getState().commit(templates[1].build()); // current project now has content
    const before = useEditor.getState().history.present;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    let closed = false;
    render(<TemplateGallery onClose={() => { closed = true; }} />);
    fireEvent.click(screen.getByText(templates[0].title));
    expect(confirm).toHaveBeenCalled();
    expect(useEditor.getState().history.present).toBe(before); // untouched
    expect(closed).toBe(false); // gallery stays open so the user can pick again or close
  });

  it('replaces the project when the user confirms', () => {
    useEditor.getState().commit(templates[1].build());
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let closed = false;
    render(<TemplateGallery onClose={() => { closed = true; }} />);
    fireEvent.click(screen.getByText(templates[0].title));
    expect(useEditor.getState().history.present.meta.name).toBe(templates[0].build().meta.name);
    expect(closed).toBe(true);
  });

  it('does not ask on a pristine (empty) project', () => {
    const confirm = vi.spyOn(window, 'confirm');
    render(<TemplateGallery onClose={() => {}} />);
    fireEvent.click(screen.getByText(templates[0].title));
    expect(confirm).not.toHaveBeenCalled();
    expect(useEditor.getState().history.present.meta.name).toBe(templates[0].build().meta.name);
  });
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
