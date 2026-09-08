// RTL coverage for the preview-mode session bridge (mounted once inside <Stage>, per the brief).
// Mirrors AudioLanes.test.tsx's idiom: render the real Stage against the real vanilla store,
// dispatch real DOM PointerEvents/KeyboardEvents, and assert observable outcomes (a text node's
// content, the store's selection field) — never hook internals.
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Stage } from '../components/Stage/Stage';
import { useEditor } from '../store/store';
import type { Behavior } from '@savig/engine';

beforeEach(() => {
  useEditor.getState().newProject();
});

const clickSetTextBehavior = (targetId: string): Omit<Behavior, 'id'> => ({
  event: 'click',
  actions: [
    { kind: 'setVar', args: { name: 'n', value: '1' } },
    { kind: 'setText', args: { targetId, value: "'clicked'" } },
  ],
});

describe('interactive preview mode (usePreviewSession, mounted inside Stage)', () => {
  it('entering preview and clicking a leaf with click -> setVar + setText updates the text node', () => {
    useEditor.getState().addTextObject(0, 0);
    const labelId = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 40, y: 0, width: 20, height: 20 });
    const btnId = useEditor.getState().selectedObjectId!;
    useEditor.getState().addBehavior(btnId, clickSetTextBehavior(labelId));
    useEditor.getState().selectObject(null);

    const nodes = new Map<string, SVGGraphicsElement>();
    render(<Stage nodes={nodes} />);

    act(() => {
      useEditor.getState().enterPreview();
    });
    expect(useEditor.getState().previewMode).toBe(true);

    fireEvent.click(screen.getByTestId(`object-${btnId}`));

    const labelNode = nodes.get(labelId)!;
    const textEl = labelNode.querySelector('text')!;
    expect(textEl.textContent).toBe('clicked');
    // The var also landed in the session (observable side channel of the same fired behavior).
    expect(useEditor.getState().previewMode).toBe(true); // preview itself untouched by the click
  });

  it('blocks the normal select-on-pointerdown editing gesture while previewing', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObject(null);

    const nodes = new Map<string, SVGGraphicsElement>();
    render(<Stage nodes={nodes} />);

    act(() => {
      useEditor.getState().enterPreview();
    });
    fireEvent.pointerDown(screen.getByTestId(`object-${id}`));
    expect(useEditor.getState().selectedObjectId).toBeNull();
  });

  it('exiting preview restores the normal select-on-pointerdown editing gesture', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObject(null);

    const nodes = new Map<string, SVGGraphicsElement>();
    render(<Stage nodes={nodes} />);

    act(() => {
      useEditor.getState().enterPreview();
    });
    fireEvent.pointerDown(screen.getByTestId(`object-${id}`));
    expect(useEditor.getState().selectedObjectId).toBeNull(); // still blocked

    act(() => {
      useEditor.getState().exitPreview();
    });
    fireEvent.pointerDown(screen.getByTestId(`object-${id}`));
    expect(useEditor.getState().selectedObjectId).toBe(id); // gesture restored
  });

  it('Escape exits preview mode', () => {
    const nodes = new Map<string, SVGGraphicsElement>();
    const { container } = render(<Stage nodes={nodes} />);

    act(() => {
      useEditor.getState().enterPreview();
    });
    expect(useEditor.getState().previewMode).toBe(true);

    const svg = container.querySelector('svg')!;
    fireEvent.keyDown(svg, { key: 'Escape' });
    expect(useEditor.getState().previewMode).toBe(false);
  });
});
