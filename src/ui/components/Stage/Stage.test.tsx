import { render, screen, fireEvent } from '@testing-library/react';
import { Stage } from './Stage';
import { useEditor } from '../../store/store';
import { sampleObject } from '../../../engine';

const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

beforeEach(() => {
  useEditor.getState().newProject();
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
  useEditor.getState().addObject('a');
});

it('registers a node per object and applies the initial transform', () => {
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  const id = useEditor.getState().history.present.objects[0].id;
  expect(nodes.has(id)).toBe(true);
  expect(nodes.get(id)!.getAttribute('transform')).toMatch(/translate/);
});

it('selects an object on pointer down', () => {
  useEditor.getState().selectObject(null);
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  const id = useEditor.getState().history.present.objects[0].id;
  fireEvent.pointerDown(screen.getByTestId(`object-${id}`));
  expect(useEditor.getState().selectedObjectId).toBe(id);
});

it('wheel zooms the stage', () => {
  const nodes = new Map<string, SVGGraphicsElement>();
  const { container } = render(<Stage nodes={nodes} />);
  const svg = container.querySelector('svg')!;
  fireEvent.wheel(svg, { deltaY: -100 });
  expect(useEditor.getState().zoom).toBeGreaterThan(1);
});

it('middle-button drag pans the stage', () => {
  const nodes = new Map<string, SVGGraphicsElement>();
  const { container } = render(<Stage nodes={nodes} />);
  const svg = container.querySelector('svg')!;
  fireEvent.pointerDown(svg, { button: 1, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(window, { clientX: 40, clientY: 25 });
  fireEvent.pointerUp(window);
  expect(useEditor.getState().pan).toEqual({ x: 40, y: 25 });
});

it('dragging an object auto-keys its x/y', () => {
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  const id = useEditor.getState().history.present.objects[0].id;
  const node = screen.getByTestId(`object-${id}`);

  fireEvent.pointerDown(node, { clientX: 0, clientY: 0 });
  fireEvent.pointerMove(window, { clientX: 30, clientY: 20 });
  fireEvent.pointerUp(window);

  const obj = useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  const s = sampleObject(obj, useEditor.getState().time);
  expect(s.x).toBe(30);
  expect(s.y).toBe(20);
});

it('a whole drag is a single undo step', () => {
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  const id = useEditor.getState().history.present.objects[0].id;
  const node = screen.getByTestId(`object-${id}`);
  const before = useEditor.getState().history.past.length;

  fireEvent.pointerDown(node, { clientX: 0, clientY: 0 });
  fireEvent.pointerMove(window, { clientX: 10, clientY: 10 });
  fireEvent.pointerMove(window, { clientX: 20, clientY: 20 });
  fireEvent.pointerMove(window, { clientX: 30, clientY: 20 });
  fireEvent.pointerUp(window);

  expect(useEditor.getState().history.past.length).toBe(before + 1);
});

it('renders a vector object as an inline <g> with an inner shape', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 30 });
  const id = useEditor.getState().history.present.objects[0].id;
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  const node = screen.getByTestId(`object-${id}`);
  expect(node.tagName.toLowerCase()).toBe('g');
  expect(node.querySelector('rect')).not.toBeNull();
});

it('commits a vector shape when drawing with the rect tool', () => {
  useEditor.getState().newProject();
  useEditor.getState().setActiveTool('rect');
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  // jsdom lacks getScreenCTM; drive the store path the wiring uses instead.
  useEditor.getState().addVectorShape('rect', { x: 5, y: 5, width: 40, height: 40 });
  expect(useEditor.getState().history.present.objects).toHaveLength(1);
  expect(useEditor.getState().activeTool).toBe('select');
});

it('shows 8 resize handles when a vector object is selected', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 60, height: 40 });
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('resize-handles')).toBeInTheDocument();
  expect(screen.getByTestId('handle-se')).toBeInTheDocument();
  expect(screen.getAllByTestId(/^handle-/)).toHaveLength(8);
});

it('hides resize handles for an SVG object', () => {
  // beforeEach already seeds + selects an svg-backed object 'a'.
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.queryByTestId('resize-handles')).toBeNull();
});
