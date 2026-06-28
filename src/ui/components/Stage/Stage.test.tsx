import { render, screen, fireEvent, act } from '@testing-library/react';
import { Stage } from './Stage';
import { useEditor } from '../../store/store';
import { sampleObject, pathToD, createProject, createSceneObject, createSymbolAsset, createVectorAsset } from '../../../engine';

const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

beforeEach(() => {
  useEditor.getState().newProject();
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
  useEditor.getState().addObject('a');
});

it('renders a symbol instance as a composite-id leaf node and selects the instance on click (slice 47a)', () => {
  // Inject a project with a symbol (one rect inside) instanced once at the top level.
  const inner = createVectorAsset('rect', { id: 'asset-inner', shapeType: 'rect' });
  const innerObj = createSceneObject('asset-inner', { id: 'inner', name: 'inner', zOrder: 1 });
  innerObj.shapeBase = { width: 10, height: 10 };
  const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj] });
  const instance = createSceneObject('sym-1', { id: 'inst', name: 'inst', zOrder: 1 });
  const project = createProject();
  project.assets = [inner, sym];
  project.objects = [instance];
  act(() => {
    useEditor.getState().commit(project);
    useEditor.getState().selectObject(null);
  });
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  // The flattened leaf carries the composite renderId; the imperative painter registers it.
  expect(nodes.has('inst/inner')).toBe(true);
  const node = screen.getByTestId('object-inst/inner');
  fireEvent.pointerDown(node);
  // Clicking an internal leaf selects the owning top-level INSTANCE (atomic in 47a).
  expect(useEditor.getState().selectedObjectId).toBe('inst');
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

it('renders a fill gradient def + reference, keeping the shape as firstElementChild', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 30 });
  const id = useEditor.getState().history.present.objects[0].id;
  useEditor.getState().setVectorGradient('fill', {
    type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5,
    stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }],
  });
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  const node = screen.getByTestId(`object-${id}`);
  const shape = node.firstElementChild!;
  expect(shape.tagName.toLowerCase()).toBe('rect');
  expect(shape.getAttribute('fill')).toBe(`url(#savig-grad-${id}-fill)`);
  const def = node.querySelector(`#savig-grad-${id}-fill`)!;
  expect(def.tagName.toLowerCase()).toBe('lineargradient');
  // autoKey is on -> the gradient lives on an animated track, NOT the asset style.
  const asset = useEditor.getState().history.present.assets.find((a) => a.kind === 'vector')!;
  expect(asset.kind === 'vector' && asset.style.fillGradient).toBeUndefined();
  expect(useEditor.getState().history.present.objects[0].gradientTracks?.fill?.length).toBe(1);
});

it('renders dash attrs + pathLength on a dashed object with an animated offset', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 30 });
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().seek(0);
  useEditor.getState().drawOn(); // dasharray [1,1] + offset track 1->0
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  const shape = screen.getByTestId(`object-${id}`).firstElementChild!;
  expect(shape.getAttribute('pathLength')).toBe('1');
  expect(shape.getAttribute('stroke-dasharray')).toBe('1 1');
  expect(shape.getAttribute('stroke-dashoffset')).toBe('1'); // sampled at t=0
});

it('renders linear gradient handles (start/end) for a selected rect with a fill gradient', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 30 });
  useEditor.getState().toggleAutoKey(); // off -> static gradient
  useEditor.getState().setVectorGradient('fill', {
    type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5,
    stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
  });
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('gradient-handles')).toBeInTheDocument();
  expect(screen.getByTestId('gradient-handle-start')).toBeInTheDocument();
  expect(screen.getByTestId('gradient-handle-end')).toBeInTheDocument();
});

it('renders radial gradient handles (center/radius/focal)', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 30 });
  useEditor.getState().toggleAutoKey();
  useEditor.getState().setVectorGradient('fill', {
    type: 'radial', cx: 0.5, cy: 0.5, r: 0.5,
    stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
  });
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('gradient-handle-center')).toBeInTheDocument();
  expect(screen.getByTestId('gradient-handle-radius')).toBeInTheDocument();
  expect(screen.getByTestId('gradient-handle-focal')).toBeInTheDocument();
});

it('renders no gradient handles for a solid object', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 30 });
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.queryByTestId('gradient-handles')).toBeNull();
});

it('dragging the end handle commits an updated gradient (autoKey off -> static)', () => {
  stubIdentityCTM(); // client coords == object-local coords
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 100, height: 100 });
  useEditor.getState().toggleAutoKey(); // off
  useEditor.getState().setVectorGradient('fill', {
    type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5,
    stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
  });
  const id = useEditor.getState().selectedObjectId!;
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  const end = screen.getByTestId('gradient-handle-end');
  fireEvent.pointerDown(end, { clientX: 100, clientY: 50, button: 0 });
  fireEvent.pointerMove(window, { clientX: 50, clientY: 0 });
  fireEvent.pointerUp(window, { clientX: 50, clientY: 0 });
  const asset = useEditor.getState().history.present.assets.find((a) => a.kind === 'vector')!;
  const g = asset.kind === 'vector' ? asset.style.fillGradient : undefined;
  expect(g && g.type === 'linear' && [g.x2, g.y2]).toEqual([0.5, 0]);
  expect(useEditor.getState().selectedObjectId).toBe(id);
});

it('dragging a handle with autoKey ON keyframes the gradient (updates the track)', () => {
  stubIdentityCTM();
  useEditor.getState().newProject(); // autoKey defaults on
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 100, height: 100 });
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().seek(0);
  useEditor.getState().setVectorGradient('fill', {
    type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5,
    stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
  });
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  const end = screen.getByTestId('gradient-handle-end');
  fireEvent.pointerDown(end, { clientX: 100, clientY: 50, button: 0 });
  fireEvent.pointerMove(window, { clientX: 50, clientY: 0 });
  fireEvent.pointerUp(window, { clientX: 50, clientY: 0 });
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  const kf = obj.gradientTracks?.fill?.[0];
  expect(kf?.gradient.type === 'linear' && [kf.gradient.x2, kf.gradient.y2]).toEqual([0.5, 0]);
});

it('renders a rotate handle for a selected rect', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 30 });
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('rotate-handle-overlay')).toBeInTheDocument();
  expect(screen.getByTestId('rotate-handle')).toBeInTheDocument();
});

it('renders a rotate handle for a selected path', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }, { anchor: { x: 20, y: 20 } }], closed: true });
  useEditor.getState().setActiveTool('select');
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('rotate-handle')).toBeInTheDocument();
});

it('renders a rotate handle for a selected imported-svg object', () => {
  const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';
  useEditor.getState().newProject();
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
  useEditor.getState().addObject('a'); // auto-selected
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('rotate-handle')).toBeInTheDocument();
  expect(screen.getByTestId('rotate-handle-overlay')).toBeInTheDocument();
});

it('dragging the rotate handle commits a rotation keyframe (autoKey on)', () => {
  stubIdentityCTM(); // client coords == object-local coords; pivot maps to the anchor
  useEditor.getState().newProject(); // autoKey defaults on
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 100, height: 100 });
  useEditor.getState().seek(0);
  const id = useEditor.getState().selectedObjectId!;
  const nodes = new Map<string, SVGGraphicsElement>([[id, document.createElementNS('http://www.w3.org/2000/svg', 'g')]]);
  render(<Stage nodes={nodes} />);
  const handle = screen.getByTestId('rotate-handle');
  // Pivot = resolved anchor (50,50) for a fraction-0.5 100x100 rect.
  // Start above the pivot (50,0) -> -90deg; drag to the right (100,50) -> 0deg => +90.
  fireEvent.pointerDown(handle, { clientX: 50, clientY: 0, button: 0 });
  fireEvent.pointerMove(window, { clientX: 100, clientY: 50 });
  fireEvent.pointerUp(window, { clientX: 100, clientY: 50 });
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  expect(obj.tracks.rotation?.[0].value).toBeCloseTo(90);
});

it('dragging the rotate handle on an imported-svg object commits a rotation keyframe', () => {
  stubIdentityCTM(); // client coords == object-local coords; pivot maps to the anchor
  const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';
  useEditor.getState().newProject(); // autoKey defaults on
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 100 100', width: 100, height: 100 });
  useEditor.getState().addObject('a'); // anchor = (50,50) absolute
  useEditor.getState().seek(0);
  const id = useEditor.getState().selectedObjectId!;
  const nodes = new Map<string, SVGGraphicsElement>([[id, document.createElementNS('http://www.w3.org/2000/svg', 'g')]]);
  render(<Stage nodes={nodes} />);
  const handle = screen.getByTestId('rotate-handle');
  // Pivot = anchor (50,50). Start above the pivot (50,0) -> -90deg; drag right (100,50) -> 0deg => +90.
  fireEvent.pointerDown(handle, { clientX: 50, clientY: 0, button: 0 });
  fireEvent.pointerMove(window, { clientX: 100, clientY: 50 });
  fireEvent.pointerUp(window, { clientX: 100, clientY: 50 });
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  expect(obj.tracks.rotation?.[0].value).toBeCloseTo(90);
});

it('renders scale handles for a selected imported-svg object', () => {
  const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';
  useEditor.getState().newProject();
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 100 100', width: 100, height: 100 });
  useEditor.getState().addObject('a'); // auto-selected
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('scale-handles')).toBeInTheDocument();
  expect(screen.getByTestId('scale-handle-se')).toBeInTheDocument();
});

it('renders scale handles for a selected path object', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 40, y: 0 } }, { anchor: { x: 40, y: 30 } }], closed: true });
  useEditor.getState().setActiveTool('select');
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('scale-handles')).toBeInTheDocument();
});

it('renders NO scale handles for a rect (it has resize handles)', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 30 });
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.queryByTestId('scale-handles')).toBeNull();
  expect(screen.getByTestId('resize-handles')).toBeInTheDocument();
});

it('dragging a scale corner on an imported-svg object commits scaleX/scaleY', () => {
  stubIdentityCTM(); // client coords == content coords
  const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';
  useEditor.getState().newProject(); // autoKey on
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 100 100', width: 100, height: 100 });
  useEditor.getState().addObject('a'); // anchor (50,50), at (0,0)
  useEditor.getState().seek(0);
  const id = useEditor.getState().selectedObjectId!;
  const nodes = new Map<string, SVGGraphicsElement>([[id, document.createElementNS('http://www.w3.org/2000/svg', 'g')]]);
  render(<Stage nodes={nodes} />);
  const se = screen.getByTestId('scale-handle-se'); // SE corner, content (100,100) at scale 1
  fireEvent.pointerDown(se, { clientX: 100, clientY: 100, button: 0 });
  fireEvent.pointerMove(window, { clientX: 200, clientY: 200 }); // drag out -> scale 2
  fireEvent.pointerUp(window, { clientX: 200, clientY: 200 });
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  expect(obj.tracks.scaleX?.[0].value).toBeCloseTo(2);
  expect(obj.tracks.scaleY?.[0].value).toBeCloseTo(2);
});

it('shift-dragging a resize corner aspect-locks a rect (width/height preserved)', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 200, height: 120 });
  useEditor.getState().seek(0);
  const id = useEditor.getState().selectedObjectId!;
  const nodes = new Map<string, SVGGraphicsElement>([[id, document.createElementNS('http://www.w3.org/2000/svg', 'g')]]);
  render(<Stage nodes={nodes} />);
  const se = screen.getByTestId('handle-se'); // rect SE resize handle, local (200,120)
  fireEvent.pointerDown(se, { clientX: 200, clientY: 120, button: 0 });
  fireEvent.pointerMove(window, { clientX: 260, clientY: 60, shiftKey: true }); // off-diagonal + shift
  fireEvent.pointerUp(window, { clientX: 260, clientY: 60, shiftKey: true });
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  expect(obj.tracks.width?.[0].value).toBeDefined(); // a resize was actually committed
  const w = obj.tracks.width![0].value;
  const h = obj.tracks.height![0].value;
  expect(w / h).toBeCloseTo(200 / 120); // aspect locked
});

it('shift-dragging a scale corner aspect-locks an imported-svg object (scaleX === scaleY)', () => {
  stubIdentityCTM(); // client coords == content coords
  const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';
  useEditor.getState().newProject();
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 100 100', width: 100, height: 100 });
  useEditor.getState().addObject('a'); // anchor (50,50), at (0,0)
  useEditor.getState().seek(0);
  const id = useEditor.getState().selectedObjectId!;
  const nodes = new Map<string, SVGGraphicsElement>([[id, document.createElementNS('http://www.w3.org/2000/svg', 'g')]]);
  render(<Stage nodes={nodes} />);
  const se = screen.getByTestId('scale-handle-se'); // content (100,100) at scale 1
  fireEvent.pointerDown(se, { clientX: 100, clientY: 100, button: 0 });
  fireEvent.pointerMove(window, { clientX: 200, clientY: 150, shiftKey: true }); // off-diagonal + shift
  fireEvent.pointerUp(window, { clientX: 200, clientY: 150, shiftKey: true });
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  expect(obj.tracks.scaleX?.[0].value).toBeCloseTo(obj.tracks.scaleY?.[0].value ?? -1); // aspect locked
  expect(obj.tracks.scaleX?.[0].value).toBeCloseTo(1.75);
});

it('Alt-dragging a scale corner scales an imported-svg object about its centre (position unchanged)', () => {
  stubIdentityCTM();
  const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';
  useEditor.getState().newProject();
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 100 100', width: 100, height: 100 });
  useEditor.getState().addObject('a'); // anchor (50,50), at (0,0)
  useEditor.getState().seek(0);
  const id = useEditor.getState().selectedObjectId!;
  const nodes = new Map<string, SVGGraphicsElement>([[id, document.createElementNS('http://www.w3.org/2000/svg', 'g')]]);
  render(<Stage nodes={nodes} />);
  const se = screen.getByTestId('scale-handle-se'); // content (100,100) at scale 1
  fireEvent.pointerDown(se, { clientX: 100, clientY: 100, button: 0 });
  fireEvent.pointerMove(window, { clientX: 150, clientY: 150, altKey: true }); // from centre -> scale 2
  fireEvent.pointerUp(window, { clientX: 150, clientY: 150, altKey: true });
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  // From centre: corner 50px from anchor -> 100px = scale 2 (opposite-fixed would be 1.5).
  expect(obj.tracks.scaleX?.[0].value).toBeCloseTo(2);
  expect(obj.tracks.scaleY?.[0].value).toBeCloseTo(2);
  // Position (base) unchanged — opposite-fixed mode would shift x/y to 25.
  expect(obj.tracks.x?.[0].value ?? 0).toBeCloseTo(0);
  expect(obj.tracks.y?.[0].value ?? 0).toBeCloseTo(0);
});

it('Alt-dragging a resize corner grows a rect symmetrically about its centre', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 200, height: 120 });
  useEditor.getState().seek(0);
  const id = useEditor.getState().selectedObjectId!;
  const nodes = new Map<string, SVGGraphicsElement>([[id, document.createElementNS('http://www.w3.org/2000/svg', 'g')]]);
  render(<Stage nodes={nodes} />);
  const se = screen.getByTestId('handle-se'); // rect SE resize handle, local (200,120); centre (100,60)
  fireEvent.pointerDown(se, { clientX: 200, clientY: 120, button: 0 });
  fireEvent.pointerMove(window, { clientX: 260, clientY: 80, altKey: true });
  fireEvent.pointerUp(window, { clientX: 260, clientY: 80, altKey: true });
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  // From centre: w=2*|260-100|=320, h=2*|80-60|=40 (opposite-fixed would be 260x80).
  expect(obj.tracks.width?.[0].value).toBeCloseTo(320);
  expect(obj.tracks.height?.[0].value).toBeCloseTo(40);
});

it('renders edge scale handles and an E drag scales only X on an imported-svg object', () => {
  stubIdentityCTM(); // client coords == content coords
  const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';
  useEditor.getState().newProject();
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 100 100', width: 100, height: 100 });
  useEditor.getState().addObject('a'); // anchor (50,50), at (0,0)
  useEditor.getState().seek(0);
  const id = useEditor.getState().selectedObjectId!;
  const nodes = new Map<string, SVGGraphicsElement>([[id, document.createElementNS('http://www.w3.org/2000/svg', 'g')]]);
  render(<Stage nodes={nodes} />);
  const e = screen.getByTestId('scale-handle-e'); // right-edge mid, content (100,50) at scale 1
  fireEvent.pointerDown(e, { clientX: 100, clientY: 50, button: 0 });
  fireEvent.pointerMove(window, { clientX: 200, clientY: 50 }); // drag right -> scaleX 2
  fireEvent.pointerUp(window, { clientX: 200, clientY: 50 });
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  expect(obj.tracks.scaleX?.[0].value).toBeCloseTo(2);
  expect(obj.tracks.scaleY?.[0].value).toBeCloseTo(1); // Y unchanged (single-axis)
});

it('renders no onion skins when the flag is off', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 30 });
  useEditor.getState().setProperty('x', 10); // a keyframe at t=0
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.queryByTestId('onion-skins')).toBeNull();
});

it('renders before/after onion ghosts for an animated selected object', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 30 });
  useEditor.getState().seek(0);
  useEditor.getState().setProperty('x', 0); // keyframe at 0
  useEditor.getState().seek(2);
  useEditor.getState().setProperty('x', 100); // keyframe at 2
  useEditor.getState().seek(1); // playhead between them
  useEditor.getState().toggleOnionSkin();
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('onion-skins')).toBeInTheDocument();
  expect(screen.getByTestId('onion-ghost-before-0')).toBeInTheDocument();
  expect(screen.getByTestId('onion-ghost-after-0')).toBeInTheDocument();
});

it('renders no onion group for a static selected object even with the flag on', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 30 });
  useEditor.getState().toggleOnionSkin();
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.queryByTestId('onion-skins')).toBeNull();
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

it('renders a node overlay for a selected path in node mode', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorPath({
    nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 10 } }],
    closed: false,
  });
  // addVectorPath switches to the node tool and selects the new object.
  expect(useEditor.getState().activeTool).toBe('node');
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('node-overlay')).toBeInTheDocument();
  expect(screen.getByTestId('node-0')).toBeInTheDocument();
  expect(screen.getByTestId('node-2')).toBeInTheDocument();
});

describe('pen wiring (identity-CTM stub)', () => {
  const proto = SVGSVGElement.prototype as unknown as {
    createSVGPoint?: () => unknown;
  };
  const gproto = SVGElement.prototype as unknown as {
    getScreenCTM?: () => unknown;
  };
  const origPoint = proto.createSVGPoint;
  const origCtm = gproto.getScreenCTM;
  beforeEach(() => {
    proto.createSVGPoint = function () {
      const p = { x: 0, y: 0, matrixTransform: () => ({ x: p.x, y: p.y }) };
      return p;
    };
    gproto.getScreenCTM = () => ({ inverse: () => ({}) });
  });
  afterEach(() => {
    proto.createSVGPoint = origPoint;
    gproto.getScreenCTM = origCtm;
  });

  it('pen clicks build a draft preview and double-click commits an open path', () => {
    useEditor.getState().newProject();
    useEditor.getState().setActiveTool('pen');
    const nodes = new Map<string, SVGGraphicsElement>();
    const { container } = render(<Stage nodes={nodes} />);
    const svg = container.querySelector('svg')!;

    fireEvent.pointerDown(svg, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window);
    fireEvent.pointerDown(svg, { clientX: 40, clientY: 10 });
    fireEvent.pointerUp(window);
    expect(screen.getByTestId('pen-draft')).toBeInTheDocument();

    fireEvent.doubleClick(svg);
    const proj = useEditor.getState().history.present;
    expect(proj.objects).toHaveLength(1);
    const asset = proj.assets.find((a) => a.kind === 'vector' && a.shapeType === 'path')!;
    expect(asset.kind === 'vector' && asset.path!.closed).toBe(false);
  });
});

it('renders a path object as a <path> with d from pathToD and no resize handles', () => {
  useEditor.getState().newProject();
  const path = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 10 } }], closed: false };
  useEditor.getState().addVectorPath(path);
  const obj = useEditor.getState().history.present.objects[0];
  useEditor.getState().selectObject(obj.id);

  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  const pathEl = document.querySelector(`[data-testid="object-${obj.id}"] path`)!;
  // bbox-min is (0,0) here, so the stored (normalized) path equals the input
  expect(pathEl.getAttribute('d')).toBe(pathToD(path));
  // select tool: paths are move-only, no resize handle overlay
  expect(screen.queryByTestId('resize-handles')).toBeNull();
});

it('node overlay reflects the sampled shape while morphing', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorPath({
    nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
    closed: false,
  });
  useEditor.getState().addShapeKeyframe();        // t=0 from base (node1 x=10)
  useEditor.getState().seek(2);
  useEditor.getState().setPathData({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 30, y: 0 } }] }); // t=2 node1 x=30
  useEditor.getState().seek(1);                   // midpoint -> node1 x samples to 20
  useEditor.getState().setActiveTool('node');
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  const node1 = screen.getByTestId('node-1');
  // node rect x = anchor.x - 4/zoom; zoom defaults to 1, sampled anchor.x = 20 -> 16
  expect(Number(node1.getAttribute('x'))).toBeCloseTo(16, 1);
});

describe('correspondence overlay', () => {
  function seedTrack() {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
    s.addShapeKeyframe(); // kf@0, 2 nodes
    s.seek(1);
    // kf@1 with an extra node -> b2 will be unreferenced under identity [0,1].
    s.setPathData({ nodes: [{ anchor: { x: 0, y: 1 } }, { anchor: { x: 10, y: 1 } }, { anchor: { x: 20, y: 1 } }], closed: false });
    const id = useEditor.getState().selectedObjectId!;
    s.seek(0);
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
    return id;
  }

  it('renders the overlay with links and a grow marker when editing', () => {
    seedTrack();
    useEditor.getState().enterCorrespondenceEdit();
    const nodes = new Map<string, SVGGraphicsElement>();
    render(<Stage nodes={nodes} />);
    expect(screen.getByTestId('correspondence-overlay')).toBeInTheDocument();
    // identity map [0,1] over 3 B nodes -> b2 unreferenced -> grow marker present.
    expect(screen.getByTestId('grow-target-2')).toBeInTheDocument();
    expect(screen.getByTestId('corr-link-0')).toBeInTheDocument();
  });

  it('does not render the overlay when not editing', () => {
    seedTrack();
    const nodes = new Map<string, SVGGraphicsElement>();
    render(<Stage nodes={nodes} />);
    expect(screen.queryByTestId('correspondence-overlay')).toBeNull();
  });

  it('colors links with the danger token when the map is crossing (non-order-preserving)', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorPath({
      nodes: [
        { anchor: { x: 0, y: 0 } },
        { anchor: { x: 10, y: 0 } },
        { anchor: { x: 10, y: 10 } },
        { anchor: { x: 0, y: 10 } },
      ],
      closed: true,
    });
    s.addShapeKeyframe();
    s.seek(1);
    s.addShapeKeyframe();
    const id = useEditor.getState().selectedObjectId!;
    s.seek(0);
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
    // [0,2,1,3] is a genuine crossing at n=4 (neither rotation nor reflection).
    useEditor.getState().setSelectedShapeKeyframeCorrespondence([0, 2, 1, 3]);
    useEditor.getState().enterCorrespondenceEdit();
    const nodes = new Map<string, SVGGraphicsElement>();
    render(<Stage nodes={nodes} />);
    expect(screen.getByTestId('corr-link-0').getAttribute('stroke')).toBe('var(--color-danger)');
  });

  it('dragging A-handle 1 onto B-node 0 sets correspondence[1] = 0', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
    s.addShapeKeyframe();
    s.seek(1);
    s.addShapeKeyframe();
    const id = useEditor.getState().selectedObjectId!;
    s.seek(0);
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
    useEditor.getState().enterCorrespondenceEdit();
    const nodes = new Map<string, SVGGraphicsElement>();
    render(<Stage nodes={nodes} />);

    fireEvent.pointerDown(screen.getByTestId('corr-a-1'));
    fireEvent.pointerUp(screen.getByTestId('corr-b-0'));

    // identity [0,1] then c[1]=0 => [0,0].
    expect(useEditor.getState().history.present.objects[0].shapeTrack![0].correspondence).toEqual([0, 0]);
  });
});

it('marks nodes that carry a custom easing in the node overlay', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
  s.addShapeKeyframe();
  s.seek(0);
  useEditor.getState().selectNode(1);
  useEditor.getState().setSelectedNodeEasing('easeIn'); // node 1 customized
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('node-easing-marker-1')).toBeInTheDocument();
  expect(screen.queryByTestId('node-easing-marker-0')).toBeNull();
});

it('renders the motion guide overlay and a followed-position marker for the selected object', () => {
  const id = useEditor.getState().history.present.objects[0].id;
  useEditor.getState().selectObject(id);
  useEditor.getState().addMotionPath(id, { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }], closed: false });
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('motion-guide')).toBeInTheDocument();
  expect(screen.getByTestId('motion-marker')).toBeInTheDocument();
});

// jsdom has no SVG CTM/matrix API; stub it to identity so clientToLocal maps
// client coords straight through to stage-local coords for the draw machine.
function stubIdentityCTM() {
  const ident = { inverse: () => ident } as unknown as DOMMatrix;
  const proto = SVGElement.prototype as unknown as {
    getScreenCTM: () => DOMMatrix;
  };
  proto.getScreenCTM = () => ident;
  Object.defineProperty(SVGElement.prototype, 'ownerSVGElement', {
    configurable: true,
    get() {
      return {
        createSVGPoint() {
          const p = { x: 0, y: 0, matrixTransform: () => ({ x: p.x, y: p.y }) };
          return p;
        },
      };
    },
  });
}

it('stamps a polygon via drag and creates a path object', () => {
  stubIdentityCTM();
  const nodes = new Map<string, SVGGraphicsElement>();
  const { container } = render(<Stage nodes={nodes} />);
  const before = useEditor.getState().history.present.objects.length;
  useEditor.getState().setActiveTool('polygon');
  const svg = container.querySelector('svg')!;

  fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0 });
  fireEvent.pointerMove(window, { clientX: 100, clientY: 140 });
  fireEvent.pointerUp(window, { clientX: 100, clientY: 140 });

  const objs = useEditor.getState().history.present.objects;
  expect(objs.length).toBe(before + 1);
  const asset = useEditor.getState().history.present.assets.find((a) => a.id === objs[objs.length - 1].assetId);
  expect(asset?.kind === 'vector' && asset.shapeType).toBe('path');
});

it('brush drag commits a round-capped smooth path object', () => {
  stubIdentityCTM();
  const nodes = new Map<string, SVGGraphicsElement>();
  const { container } = render(<Stage nodes={nodes} />);
  const before = useEditor.getState().history.present.objects.length;
  useEditor.getState().setActiveTool('brush');
  const svg = container.querySelector('svg')!;

  fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0 });
  fireEvent.pointerMove(window, { clientX: 140, clientY: 80 });
  fireEvent.pointerMove(window, { clientX: 180, clientY: 120 });
  fireEvent.pointerMove(window, { clientX: 220, clientY: 90 });
  fireEvent.pointerUp(window, { clientX: 220, clientY: 90 });

  const proj = useEditor.getState().history.present;
  expect(proj.objects.length).toBe(before + 1);
  const asset = proj.assets[proj.assets.length - 1];
  expect(asset.kind).toBe('vector');
  if (asset.kind === 'vector' && asset.shapeType === 'path' && asset.path) {
    expect(asset.style.strokeLinecap).toBe('round');
    expect(asset.style.strokeWidth).toBe(useEditor.getState().brushSize);
    expect(asset.path.nodes.length).toBeGreaterThanOrEqual(2);
  }
});

it('a single-point brush tap commits nothing', () => {
  stubIdentityCTM();
  const nodes = new Map<string, SVGGraphicsElement>();
  const { container } = render(<Stage nodes={nodes} />);
  const before = useEditor.getState().history.present.objects.length;
  useEditor.getState().setActiveTool('brush');
  const svg = container.querySelector('svg')!;

  fireEvent.pointerDown(svg, { clientX: 5, clientY: 5, button: 0 });
  fireEvent.pointerUp(window, { clientX: 5, clientY: 5 });

  expect(useEditor.getState().history.present.objects.length).toBe(before);
});

it('does not render a hidden object', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().toggleObjectVisibility(id);
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.queryByTestId(`object-${id}`)).toBeNull();
});

it('a pointer down on a locked object does not select it and bubbles to a background deselect', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 30 }); // A
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 100, y: 0, width: 50, height: 30 }); // B (selected)
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().toggleObjectLock(a); // lock A; selection stays B
  expect(useEditor.getState().selectedObjectId).toBe(b);
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  // Click the LOCKED object: it bubbles to the background; a non-drag click deselects on up (slice 38).
  fireEvent.pointerDown(screen.getByTestId(`object-${a}`));
  fireEvent.pointerUp(window);
  expect(useEditor.getState().selectedObjectId).toBeNull(); // bubbled to background -> deselected B
});

it('hides the resize-handle overlay for a hidden selected object', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 30 });
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().toggleObjectVisibility(id); // hide; visibility does NOT deselect
  expect(useEditor.getState().selectedObjectId).toBe(id);
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.queryByTestId('resize-handles')).toBeNull();
});

it('snaps a dragged object to another object/artboard edge and shows a guide', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().setSnapEnabled(true);
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 100, height: 50 }); // target: left edge x=0
  useEditor.getState().addVectorShape('rect', { x: 300, y: 300, width: 100, height: 50 }); // mover (selected)
  useEditor.getState().seek(0);
  const moverId = useEditor.getState().selectedObjectId!;
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const o of useEditor.getState().history.present.objects) {
    nodes.set(o.id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  }
  const { container } = render(<Stage nodes={nodes} />);
  const mover = container.querySelector(`[data-savig-object="${moverId}"]`)!;
  // Drag the mover's x from 300 toward 3 (delta -297); minX 3 is within 6px of the 0 edge.
  fireEvent.pointerDown(mover, { clientX: 400, clientY: 300, button: 0 });
  fireEvent.pointerMove(window, { clientX: 103, clientY: 300 });
  expect(screen.getByTestId('snap-guide-x')).toBeInTheDocument(); // guide visible mid-drag
  fireEvent.pointerUp(window, { clientX: 103, clientY: 300 });
  const moverObj = useEditor.getState().history.present.objects.find((o) => o.id === moverId)!;
  expect(sampleObject(moverObj, 0).x).toBeCloseTo(0); // snapped from raw 3 to the 0 edge
  expect(screen.queryByTestId('snap-guide-x')).toBeNull(); // cleared on pointer-up
});

it('does not snap a dragged object when snapping is disabled', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().setSnapEnabled(false);
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 100, height: 50 });
  useEditor.getState().addVectorShape('rect', { x: 300, y: 300, width: 100, height: 50 });
  useEditor.getState().seek(0);
  const moverId = useEditor.getState().selectedObjectId!;
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const o of useEditor.getState().history.present.objects) {
    nodes.set(o.id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  }
  const { container } = render(<Stage nodes={nodes} />);
  const mover = container.querySelector(`[data-savig-object="${moverId}"]`)!;
  fireEvent.pointerDown(mover, { clientX: 400, clientY: 300, button: 0 });
  fireEvent.pointerMove(window, { clientX: 103, clientY: 300 });
  expect(screen.queryByTestId('snap-guide-x')).toBeNull(); // no guide when disabled
  fireEvent.pointerUp(window, { clientX: 103, clientY: 300 });
  const moverObj = useEditor.getState().history.present.objects.find((o) => o.id === moverId)!;
  expect(sampleObject(moverObj, 0).x).toBeCloseTo(3); // raw, unsnapped
  useEditor.getState().setSnapEnabled(true); // restore the default for any later tests
});

it('shift-clicking a second object adds it to the selection and outlines both (no drag)', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 50 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 200, y: 0, width: 50, height: 50 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObject(a);
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const o of useEditor.getState().history.present.objects) {
    nodes.set(o.id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  }
  const { container } = render(<Stage nodes={nodes} />);
  const elB = container.querySelector(`[data-savig-object="${b}"]`)!;
  fireEvent.pointerDown(elB, { clientX: 210, clientY: 10, button: 0, shiftKey: true });
  expect(useEditor.getState().selectedObjectIds).toEqual([a, b]);
  expect(screen.getByTestId(`selection-outline-${a}`)).toBeInTheDocument();
  expect(screen.getByTestId(`selection-outline-${b}`)).toBeInTheDocument();
});

it('dragging one object of a multi-selection moves them all (one undo step)', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 40 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 100, y: 0, width: 40, height: 40 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  const xy = (id: string) => {
    const o = useEditor.getState().history.present.objects.find((p) => p.id === id)!;
    const s = sampleObject(o, 0);
    return { x: s.x, y: s.y };
  };
  const a0 = xy(a);
  const b0 = xy(b);
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const o of useEditor.getState().history.present.objects) {
    nodes.set(o.id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  }
  const { container } = render(<Stage nodes={nodes} />);
  const elA = container.querySelector(`[data-savig-object="${a}"]`)!;
  fireEvent.pointerDown(elA, { clientX: 10, clientY: 10, button: 0 }); // plain click on a SELECTED member -> multi-drag
  fireEvent.pointerMove(window, { clientX: 40, clientY: 30 }); // delta (30, 20)
  const past = useEditor.getState().history.past.length;
  fireEvent.pointerUp(window, { clientX: 40, clientY: 30 });
  expect(xy(a)).toEqual({ x: a0.x + 30, y: a0.y + 20 });
  expect(xy(b)).toEqual({ x: b0.x + 30, y: b0.y + 20 });
  expect(useEditor.getState().history.past.length).toBe(past + 1); // one commit for the whole move
});

it('a locked member of a multi-selection keeps its outline put during a multi-drag', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 40 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 100, y: 0, width: 40, height: 40 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().toggleObjectLock(a); // a is now locked
  useEditor.getState().selectObjects([a, b]); // a (locked) + b in the selection
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const o of useEditor.getState().history.present.objects) {
    nodes.set(o.id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  }
  const { container } = render(<Stage nodes={nodes} />);
  const ax0 = screen.getByTestId(`selection-outline-${a}`).getAttribute('x');
  const elB = container.querySelector(`[data-savig-object="${b}"]`)!;
  fireEvent.pointerDown(elB, { clientX: 110, clientY: 10, button: 0 }); // multi-drag (b is in [a,b])
  fireEvent.pointerMove(window, { clientX: 150, clientY: 10 }); // delta (40, 0)
  expect(screen.getByTestId(`selection-outline-${a}`).getAttribute('x')).toBe(ax0); // locked a: outline unmoved
  expect(Number(screen.getByTestId(`selection-outline-${b}`).getAttribute('x'))).toBeGreaterThan(100); // b: outline followed
  fireEvent.pointerUp(window, { clientX: 150, clientY: 10 });
});

it('marquee-dragging the background selects intersecting objects', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 40 }); // AABB 0..40
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 200, y: 0, width: 40, height: 40 }); // AABB 200..240
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObject(null);
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const o of useEditor.getState().history.present.objects) {
    nodes.set(o.id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  }
  const { container } = render(<Stage nodes={nodes} />);
  const svg = container.querySelector('svg')!;
  // A marquee from (-10,-10) to (50,50) covers only A (0..40), not B (200..240).
  fireEvent.pointerDown(svg, { clientX: -10, clientY: -10, button: 0 });
  fireEvent.pointerMove(window, { clientX: 50, clientY: 50 });
  expect(screen.getByTestId('marquee')).toBeInTheDocument();
  fireEvent.pointerUp(window, { clientX: 50, clientY: 50 });
  expect(useEditor.getState().selectedObjectIds).toEqual([a]);
  expect(useEditor.getState().selectedObjectIds).not.toContain(b);
  expect(screen.queryByTestId('marquee')).toBeNull(); // cleared on release
});

it('a background click (no drag) deselects', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 40 });
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const o of useEditor.getState().history.present.objects) {
    nodes.set(o.id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  }
  const { container } = render(<Stage nodes={nodes} />);
  const svg = container.querySelector('svg')!;
  fireEvent.pointerDown(svg, { clientX: 5, clientY: 5, button: 0 });
  fireEvent.pointerUp(window, { clientX: 5, clientY: 5 }); // no move
  expect(useEditor.getState().selectedObjectIds).toEqual([]);
});

it('renders group handles for a multi-selection and hides the single-object handles', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 40 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 100, y: 0, width: 40, height: 40 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const o of useEditor.getState().history.present.objects) {
    nodes.set(o.id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  }
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('group-handles')).toBeInTheDocument();
  expect(screen.getByTestId('group-handle-se')).toBeInTheDocument();
  expect(screen.queryByTestId('resize-handles')).toBeNull(); // single-object overlays hidden
  expect(screen.queryByTestId('scale-handles')).toBeNull();
});

it('dragging the group SE handle scales the whole selection about the NW pivot', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 40 }); // AABB 0..40
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 100, y: 0, width: 40, height: 40 }); // AABB 100..140
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const o of useEditor.getState().history.present.objects) {
    nodes.set(o.id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  }
  render(<Stage nodes={nodes} />);
  // group bbox x:0..140 y:0..40; SE handle at (140,40); NW pivot at (0,0).
  const se = screen.getByTestId('group-handle-se');
  fireEvent.pointerDown(se, { clientX: 140, clientY: 40, button: 0 });
  fireEvent.pointerMove(window, { clientX: 280, clientY: 80 }); // sx=280/140=2, sy=80/40=2
  fireEvent.pointerUp(window, { clientX: 280, clientY: 80 });
  const sa = sampleObject(useEditor.getState().history.present.objects.find((o) => o.id === a)!, 0);
  // a centred at (20,20), pivot (0,0): new anchor 2*(20,20)=(40,40) -> base 40-20=20; scale x2.
  expect(sa.scaleX).toBeCloseTo(2);
  expect(sa.x).toBeCloseTo(20);
  // b: base (100,0), anchor (20,20) -> artboard (120,20); x2 about (0,0) -> (240,40) -> base 240-20=220.
  const sb = sampleObject(useEditor.getState().history.present.objects.find((o) => o.id === b)!, 0);
  expect(sb.scaleX).toBeCloseTo(2);
  expect(sb.x).toBeCloseTo(220);
});

it('dragging the group rotate handle rotates the whole selection about the group centre', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 40 }); // a, AABB 0..40
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 100, y: 0, width: 40, height: 40 }); // b, AABB 100..140
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const o of useEditor.getState().history.present.objects) {
    nodes.set(o.id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  }
  render(<Stage nodes={nodes} />);
  // group centre (70,20); handle straight up. start above centre -> right of centre = +90deg.
  const h = screen.getByTestId('group-rotate-handle');
  fireEvent.pointerDown(h, { clientX: 70, clientY: 20 - 24, button: 0 });
  fireEvent.pointerMove(window, { clientX: 170, clientY: 20 });
  fireEvent.pointerUp(window, { clientX: 170, clientY: 20 });
  const sa = sampleObject(useEditor.getState().history.present.objects.find((o) => o.id === a)!, 0);
  const sb = sampleObject(useEditor.getState().history.present.objects.find((o) => o.id === b)!, 0);
  // R(90) about (70,20): a anchor (20,20) -> (70,-30) -> base (50,-50); b (120,20) -> (70,70) -> base (50,50).
  expect(sa.rotation).toBeCloseTo(90);
  expect(sa.x).toBeCloseTo(50);
  expect(sa.y).toBeCloseTo(-50);
  expect(sb.rotation).toBeCloseTo(90);
  expect(sb.x).toBeCloseTo(50);
  expect(sb.y).toBeCloseTo(50);
});

it('clicking a grouped member selects the GROUP container (slice 45b)', () => {
  const s = useEditor.getState();
  s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const a = useEditor.getState().selectedObjectId!;
  s.addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  useEditor.getState().groupSelected();
  const gid = useEditor.getState().history.present.objects.find((o) => o.isGroup)!.id;
  useEditor.getState().selectObject(null);
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  fireEvent.pointerDown(screen.getByTestId(`object-${a}`));
  expect(useEditor.getState().selectedObjectIds).toEqual([gid]); // the group, not the member
});

it('a single click-drag on a grouped member moves the GROUP as a unit (slice 45b/d)', () => {
  const s = useEditor.getState();
  s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const a = useEditor.getState().selectedObjectId!;
  s.addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  useEditor.getState().groupSelected();
  const gid = useEditor.getState().history.present.objects.find((o) => o.isGroup)!.id;
  useEditor.getState().selectObject(null); // one-gesture path
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  const objOf = (id: string) => useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  const gBefore = sampleObject(objOf(gid), 0);
  const aBefore = { ...objOf(a).base };
  // One uninterrupted gesture: pointer-down on member A then drag (no prior click).
  fireEvent.pointerDown(screen.getByTestId(`object-${a}`), { clientX: 0, clientY: 0 });
  fireEvent.pointerMove(window, { clientX: 30, clientY: 20 });
  fireEvent.pointerUp(window);
  // The GROUP moved by (+30,+20) — keyframed at the playhead (auto-key on); the member's
  // own base is untouched (it composes the group transform at render time).
  const gAfter = sampleObject(objOf(gid), 0);
  expect([gAfter.x - gBefore.x, gAfter.y - gBefore.y]).toEqual([30, 20]);
  expect([objOf(a).base.x, objOf(a).base.y]).toEqual([aBefore.x, aBefore.y]);
});

it('a multi-selection move-drag snaps the group bbox to another object (slice 44)', () => {
  const s = useEditor.getState();
  s.newProject();
  // Target T (unselected), WIDE so only its left edge (x=50) is within snap range of the
  // dragged group's left edge — its center (150) / right (250) stay out of contention.
  s.addVectorShape('rect', { x: 50, y: 200, width: 200, height: 10 });
  const tg = useEditor.getState().selectedObjectId!;
  s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const a = useEditor.getState().selectedObjectId!;
  s.addVectorShape('rect', { x: 20, y: 0, width: 10, height: 10 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  // Drag +47 (group left edge -> 47): within SNAP_PX(6) of T's left edge (50) -> snaps to 50.
  fireEvent.pointerDown(screen.getByTestId(`object-${a}`), { clientX: 0, clientY: 0 });
  fireEvent.pointerMove(window, { clientX: 47, clientY: 0 });
  fireEvent.pointerUp(window);
  const xOf = (id: string) =>
    sampleObject(useEditor.getState().history.present.objects.find((o) => o.id === id)!, useEditor.getState().time).x;
  expect(xOf(a)).toBe(50); // snapped (+50), not the raw +47
  expect(xOf(b)).toBe(70); // B moved by the same snapped delta
  expect(tg).not.toBe(a);
});

it('multi-drag uses the raw delta when snapping is disabled (slice 44)', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 50, y: 200, width: 10, height: 10 }); // target, unselected
  s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const a = useEditor.getState().selectedObjectId!;
  s.addVectorShape('rect', { x: 20, y: 0, width: 10, height: 10 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().setSnapEnabled(false);
  useEditor.getState().selectObjects([a, b]);
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  fireEvent.pointerDown(screen.getByTestId(`object-${a}`), { clientX: 0, clientY: 0 });
  fireEvent.pointerMove(window, { clientX: 47, clientY: 0 });
  fireEvent.pointerUp(window);
  expect(sampleObject(useEditor.getState().history.present.objects.find((o) => o.id === a)!, useEditor.getState().time).x).toBe(47); // raw, no snap
});

it('a selected group shows the bbox handles; dragging SE scales the GROUP base (slice 45b)', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 40 }); // AABB 0..40
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 100, y: 0, width: 40, height: 40 }); // AABB 100..140
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  useEditor.getState().groupSelected();
  const gid = useEditor.getState().history.present.objects.find((o) => o.isGroup)!.id;
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const o of useEditor.getState().history.present.objects) {
    nodes.set(o.id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  }
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('group-handles')).toBeInTheDocument(); // a single group shows the bbox handles
  // group bbox 0..140 x, 0..40 y; SE handle (140,40); NW pivot (0,0). Drag to 2x.
  fireEvent.pointerDown(screen.getByTestId('group-handle-se'), { clientX: 140, clientY: 40, button: 0 });
  fireEvent.pointerMove(window, { clientX: 280, clientY: 80 });
  fireEvent.pointerUp(window, { clientX: 280, clientY: 80 });
  const group = useEditor.getState().history.present.objects.find((o) => o.id === gid)!;
  expect(sampleObject(group, 0).scaleX).toBeCloseTo(2); // the GROUP scaled (keyframed @ auto-key on)
  expect(group.tracks.scaleX ?? []).toHaveLength(1); // animatable: a keyframe at the playhead (45d)
  // the children's OWN base is untouched (they compose the group transform at render).
  expect(useEditor.getState().history.present.objects.find((o) => o.id === a)!.base.scaleX).toBe(1);
});

it('dragging the group rotate handle rotates the GROUP (keyframed @ auto-key on) (slice 45b/d)', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 40 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 100, y: 0, width: 40, height: 40 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  useEditor.getState().groupSelected();
  const gid = useEditor.getState().history.present.objects.find((o) => o.isGroup)!.id;
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const o of useEditor.getState().history.present.objects) {
    nodes.set(o.id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  }
  render(<Stage nodes={nodes} />);
  // centre (70,20). Start above the centre -> -90deg; drag to the right of centre -> 0deg => +90.
  const rot = screen.getByTestId('group-rotate-handle');
  fireEvent.pointerDown(rot, { clientX: 70, clientY: 0, button: 0 });
  fireEvent.pointerMove(window, { clientX: 140, clientY: 20 });
  fireEvent.pointerUp(window, { clientX: 140, clientY: 20 });
  const group = useEditor.getState().history.present.objects.find((o) => o.id === gid)!;
  expect(sampleObject(group, 0).rotation).toBeCloseTo(90);
  expect(group.tracks.rotation ?? []).toHaveLength(1); // keyframed at the playhead (45d)
});

it('a group scale handle-drag previews the children live before commit (slice 45b review)', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 40 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 100, y: 0, width: 40, height: 40 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  useEditor.getState().groupSelected();
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const o of useEditor.getState().history.present.objects) {
    if (o.isGroup) continue; // groups have no DOM node (matches production render)
    nodes.set(o.id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  }
  render(<Stage nodes={nodes} />);
  fireEvent.pointerDown(screen.getByTestId('group-handle-se'), { clientX: 140, clientY: 40, button: 0 });
  fireEvent.pointerMove(window, { clientX: 280, clientY: 80 }); // 2x scale, NOT yet committed
  // The group has no node; its child's node is previewed with the in-progress group prefix.
  expect(nodes.get(a)!.getAttribute('transform')).toContain('scale(2'); // composed group scale visible mid-drag
  fireEvent.pointerUp(window, { clientX: 280, clientY: 80 });
});

it('a child of a hidden group is not rendered on the Stage (slice 45c cascade)', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  useEditor.getState().groupSelected();
  const gid = useEditor.getState().history.present.objects.find((o) => o.isGroup)!.id;
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.queryByTestId(`object-${a}`)).toBeInTheDocument();
  act(() => useEditor.getState().toggleObjectVisibility(gid)); // hide the GROUP
  expect(screen.queryByTestId(`object-${a}`)).toBeNull(); // children gone via the cascade
  expect(screen.queryByTestId(`object-${b}`)).toBeNull();
});

it('marquee does not select a hidden group through its children (slice 45c)', () => {
  stubIdentityCTM(); // client coords == content coords
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 10, y: 10, width: 20, height: 20 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 50, y: 10, width: 20, height: 20 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  useEditor.getState().groupSelected();
  const gid = useEditor.getState().history.present.objects.find((o) => o.isGroup)!.id;
  act(() => useEditor.getState().toggleObjectVisibility(gid)); // hide the GROUP
  useEditor.getState().selectObject(null);
  const nodes = new Map<string, SVGGraphicsElement>();
  const { container } = render(<Stage nodes={nodes} />);
  const svg = container.querySelector('svg')!;
  // Marquee across the whole area where the (hidden) children sit.
  fireEvent.pointerDown(svg, { clientX: 0, clientY: 0, button: 0 });
  fireEvent.pointerMove(window, { clientX: 200, clientY: 200 });
  fireEvent.pointerUp(window, { clientX: 200, clientY: 200 });
  expect(useEditor.getState().selectedObjectIds).toEqual([]); // hidden group's children not hit
});

it('shows bbox + scale + rotate handles for a single selected symbol instance (slice 47b)', () => {
  const inner = createVectorAsset('rect', { id: 'asset-inner', shapeType: 'rect' });
  const innerObj = createSceneObject('asset-inner', { id: 'inner', name: 'inner', zOrder: 0 });
  innerObj.shapeBase = { width: 20, height: 20 };
  const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj], width: 20, height: 20 });
  const instance = createSceneObject('sym-1', { id: 'inst', name: 'inst', zOrder: 1, anchorX: 10, anchorY: 10 });
  const project = createProject();
  project.assets = [inner, sym];
  project.objects = [instance];
  act(() => {
    useEditor.getState().commit(project);
    useEditor.getState().selectObject('inst');
  });
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('group-handles')).toBeInTheDocument();
  expect(screen.getByTestId('group-handle-se')).toBeInTheDocument();
  expect(screen.getByTestId('group-rotate-handle')).toBeInTheDocument();
});

it('scaling the SE handle of a single instance commits the instance scale (slice 47b)', () => {
  stubIdentityCTM(); // client coords == content coords (top-level helper already in this file)
  const inner = createVectorAsset('rect', { id: 'asset-inner', shapeType: 'rect' });
  const innerObj = createSceneObject('asset-inner', { id: 'inner', name: 'inner', zOrder: 0 });
  innerObj.shapeBase = { width: 20, height: 20 };
  const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj], width: 20, height: 20 });
  // content box is 0..20; anchor at the box centre (10,10), base identity.
  const instance = createSceneObject('sym-1', { id: 'inst', name: 'inst', zOrder: 1, anchorX: 10, anchorY: 10 });
  const project = createProject();
  project.assets = [inner, sym];
  project.objects = [instance];
  act(() => {
    useEditor.getState().commit(project);
    useEditor.getState().selectObject('inst');
    // autoKey defaults true; the handle commit keyframes the instance's own transform.
  });
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  // SE handle sits at the bbox max corner (20,20); the pivot is the NW corner (0,0).
  // Drag it to (40,40): scale factor 2 about the NW pivot (exact under the identity-CTM stub).
  const se = screen.getByTestId('group-handle-se');
  act(() => {
    fireEvent.pointerDown(se, { clientX: 20, clientY: 20, button: 0 });
  });
  act(() => {
    fireEvent.pointerMove(window, { clientX: 40, clientY: 40 });
    fireEvent.pointerUp(window, { clientX: 40, clientY: 40 });
  });
  const committed = useEditor.getState().history.present.objects.find((o) => o.id === 'inst')!;
  const s = sampleObject(committed, 0);
  expect(s.scaleX).toBeCloseTo(2, 1);
  expect(s.scaleY).toBeCloseTo(2, 1);
});

it('snaps a dragged symbol instance bbox to a neighbouring object (slice 47b)', () => {
  stubIdentityCTM();
  const inner = createVectorAsset('rect', { id: 'asset-inner', shapeType: 'rect' });
  const innerObj = createSceneObject('asset-inner', { id: 'inner', name: 'inner', zOrder: 0 });
  innerObj.shapeBase = { width: 20, height: 20 };
  const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj], width: 20, height: 20 });
  const instance = createSceneObject('sym-1', { id: 'inst', name: 'inst', zOrder: 1, anchorX: 10, anchorY: 10 });
  // a plain target rect at 100..110 (far in Y) the instance's bbox will snap to in X.
  const tgtAsset = createVectorAsset('rect', { id: 'tgt-asset', shapeType: 'rect' });
  const tgt = createSceneObject('tgt-asset', { id: 'tgt', name: 'tgt', zOrder: 0, base: { x: 100, y: 200, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
  tgt.shapeBase = { width: 10, height: 10 };
  const project = createProject();
  project.assets = [inner, sym, tgtAsset];
  project.objects = [instance, tgt];
  act(() => {
    useEditor.getState().commit(project);
    useEditor.getState().selectObject('inst');
    useEditor.getState().setSnapEnabled(true);
  });
  const nodes = new Map<string, SVGGraphicsElement>();
  const { container } = render(<Stage nodes={nodes} />);
  const leaf = container.querySelector('[data-savig-object^="inst/"]')!;
  // drag right by raw 83: instance bbox 0..20 -> 83..103; its max 103 snaps to the target
  // centre 105 (+2) so the instance lands at x=85 (snapped), not the raw 83.
  act(() => { fireEvent.pointerDown(leaf, { clientX: 5, clientY: 5, button: 0 }); });
  act(() => {
    fireEvent.pointerMove(window, { clientX: 88, clientY: 5 });
    fireEvent.pointerUp(window, { clientX: 88, clientY: 5 });
  });
  const committed = useEditor.getState().history.present.objects.find((o) => o.id === 'inst')!;
  expect(sampleObject(committed, 0).x).toBeCloseTo(85, 1); // snapped (+2); without instanceAABB baseAABB it would be 83
});

it('snaps a dragged plain object to a symbol instance bbox (slice 47b)', () => {
  stubIdentityCTM();
  const inner = createVectorAsset('rect', { id: 'asset-inner', shapeType: 'rect' });
  const innerObj = createSceneObject('asset-inner', { id: 'inner', name: 'inner', zOrder: 0 });
  innerObj.shapeBase = { width: 20, height: 20 };
  const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj], width: 20, height: 20 });
  const instance = createSceneObject('sym-1', { id: 'inst', name: 'inst', zOrder: 0, anchorX: 10, anchorY: 10 }); // bbox 0..20
  const mvAsset = createVectorAsset('rect', { id: 'mv-asset', shapeType: 'rect' });
  const mover = createSceneObject('mv-asset', { id: 'mv', name: 'mv', zOrder: 1, base: { x: 100, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
  mover.shapeBase = { width: 10, height: 10 };
  const project = createProject();
  project.assets = [inner, sym, mvAsset];
  project.objects = [instance, mover];
  act(() => {
    useEditor.getState().commit(project);
    useEditor.getState().selectObject('mv');
    useEditor.getState().setSnapEnabled(true);
  });
  const nodes = new Map<string, SVGGraphicsElement>();
  const { container } = render(<Stage nodes={nodes} />);
  const mv = container.querySelector('[data-savig-object="mv"]')!;
  // drag the mover left by raw 83: 100..110 -> 17..27; its centre 22 snaps to the instance
  // max edge 20 (-2) so it lands at x=15. Without the instance as a snap target it stays 17.
  act(() => { fireEvent.pointerDown(mv, { clientX: 5, clientY: 5, button: 0 }); });
  act(() => {
    fireEvent.pointerMove(window, { clientX: -78, clientY: 5 });
    fireEvent.pointerUp(window, { clientX: -78, clientY: 5 });
  });
  const committed = useEditor.getState().history.present.objects.find((o) => o.id === 'mv')!;
  expect(sampleObject(committed, 0).x).toBeCloseTo(15, 1); // snapped to the instance edge; without entityAABB targets it would be 17
});

it('live-previews instance leaves during a move drag (slice 47b)', () => {
  stubIdentityCTM();
  const inner = createVectorAsset('rect', { id: 'asset-inner', shapeType: 'rect' });
  const innerObj = createSceneObject('asset-inner', { id: 'inner', name: 'inner', zOrder: 0 });
  innerObj.shapeBase = { width: 20, height: 20 };
  const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj], width: 20, height: 20 });
  const instance = createSceneObject('sym-1', { id: 'inst', name: 'inst', zOrder: 0, anchorX: 10, anchorY: 10 });
  const project = createProject();
  project.assets = [inner, sym];
  project.objects = [instance];
  act(() => {
    useEditor.getState().commit(project);
    useEditor.getState().selectObject('inst');
    useEditor.getState().setSnapEnabled(false);
  });
  const nodes = new Map<string, SVGGraphicsElement>();
  const { container } = render(<Stage nodes={nodes} />);
  const leaf = container.querySelector('[data-savig-object="inst/inner"]')!;
  const before = nodes.get('inst/inner')!.getAttribute('transform');
  act(() => { fireEvent.pointerDown(leaf, { clientX: 5, clientY: 5, button: 0 }); });
  act(() => { fireEvent.pointerMove(window, { clientX: 55, clientY: 5 }); });
  const during = nodes.get('inst/inner')!.getAttribute('transform');
  expect(during).not.toBe(before); // previewInstanceChildren repainted the leaf to the dragged x
  act(() => { fireEvent.pointerUp(window, { clientX: 55, clientY: 5 }); });
});

it('a mixed multi-select scale preview keeps the plain object preview (does not revert it) (slice 47b review)', () => {
  stubIdentityCTM();
  const inner = createVectorAsset('rect', { id: 'asset-inner', shapeType: 'rect' });
  const innerObj = createSceneObject('asset-inner', { id: 'inner', name: 'inner', zOrder: 0 });
  innerObj.shapeBase = { width: 20, height: 20 };
  const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj], width: 20, height: 20 });
  const instance = createSceneObject('sym-1', { id: 'inst', name: 'inst', zOrder: 1, anchorX: 10, anchorY: 10, base: { x: 100, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
  const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
  const rect = createSceneObject('rect-asset', { id: 'rect', name: 'rect', zOrder: 0, base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
  rect.shapeBase = { width: 40, height: 40 }; // bbox 0..40 drives the multi-select group bbox
  const project = createProject();
  project.assets = [inner, sym, rectAsset];
  project.objects = [rect, instance];
  act(() => {
    useEditor.getState().commit(project);
    useEditor.getState().selectObjects(['rect', 'inst']); // rect first, instance after (the buggy order)
  });
  const nodes = new Map<string, SVGGraphicsElement>();
  const { container } = render(<Stage nodes={nodes} />);
  const rectNode = container.querySelector('[data-savig-object="rect"]')!;
  const before = rectNode.getAttribute('transform');
  const se = screen.getByTestId('group-handle-se'); // at the rect bbox max corner (40,40)
  act(() => { fireEvent.pointerDown(se, { clientX: 40, clientY: 40, button: 0 }); });
  act(() => { fireEvent.pointerMove(window, { clientX: 80, clientY: 80 }); }); // scale 2x about NW pivot
  const during = rectNode.getAttribute('transform');
  expect(during).not.toBe(before); // the plain rect keeps its in-progress preview; the instance repaint must not revert it
  act(() => { fireEvent.pointerUp(window, { clientX: 80, clientY: 80 }); });
});

it('double-clicking an instance leaf enters its symbol (slice 47 edit-mode)', () => {
  const inner = createVectorAsset('rect', { id: 'asset-inner', shapeType: 'rect' });
  const innerObj = createSceneObject('asset-inner', { id: 'inner', name: 'inner', zOrder: 0 });
  innerObj.shapeBase = { width: 20, height: 20 };
  const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj], width: 20, height: 20 });
  const instance = createSceneObject('sym-1', { id: 'inst', name: 'inst', zOrder: 0 });
  const project = createProject();
  project.assets = [inner, sym];
  project.objects = [instance];
  act(() => { useEditor.getState().commit(project); });
  const nodes = new Map<string, SVGGraphicsElement>();
  const { container } = render(<Stage nodes={nodes} />);
  const leaf = container.querySelector('[data-savig-object="inst/inner"]')!;
  act(() => { fireEvent.doubleClick(leaf); });
  expect(useEditor.getState().editPath).toEqual(['sym-1']);
});

it('draws a dashed selection-outline for a symbol instance in a multi-selection (47b polish)', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 50 });
  const a = useEditor.getState().selectedObjectId!;
  const project = useEditor.getState().history.present;
  const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
  const innerObj = createSceneObject('inner-asset', { id: 'inner', zOrder: 0 });
  innerObj.shapeBase = { width: 20, height: 20 };
  const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj], width: 20, height: 20 });
  const instance = createSceneObject('sym-1', { id: 'inst', name: 'inst', zOrder: 1, anchorX: 10, anchorY: 10, base: { x: 100, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
  act(() => {
    useEditor.getState().commit({ ...project, assets: [...project.assets, inner, sym], objects: [...project.objects, instance] });
    useEditor.getState().selectObjects([a, 'inst']);
  });
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('selection-outline-inst')).toBeInTheDocument(); // was absent under objectAABB
  expect(screen.getByTestId(`selection-outline-${a}`)).toBeInTheDocument();
});

it('previews a symbol instance leaf during a multi-select move drag (47b polish)', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 40 });
  const a = useEditor.getState().selectedObjectId!;
  const project = useEditor.getState().history.present;
  const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
  const innerObj = createSceneObject('inner-asset', { id: 'inner', zOrder: 0 });
  innerObj.shapeBase = { width: 20, height: 20 };
  const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj], width: 20, height: 20 });
  const instance = createSceneObject('sym-1', { id: 'inst', name: 'inst', zOrder: 1, base: { x: 200, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
  act(() => {
    useEditor.getState().commit({ ...project, assets: [...project.assets, inner, sym], objects: [...project.objects, instance] });
    useEditor.getState().selectObjects([a, 'inst']);
  });
  const nodes = new Map<string, SVGGraphicsElement>();
  nodes.set(a, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  nodes.set('inst/inner', document.createElementNS('http://www.w3.org/2000/svg', 'g')); // the instance's composite leaf
  const { container } = render(<Stage nodes={nodes} />);
  const before = nodes.get('inst/inner')!.getAttribute('transform') ?? '';
  const elA = container.querySelector(`[data-savig-object="${a}"]`)!;
  fireEvent.pointerDown(elA, { clientX: 10, clientY: 10, button: 0 }); // multi-drag on a selected member
  fireEvent.pointerMove(window, { clientX: 50, clientY: 10 }); // delta (40, 0)
  const after = nodes.get('inst/inner')!.getAttribute('transform') ?? '';
  fireEvent.pointerUp(window, { clientX: 50, clientY: 10 });
  expect(after).not.toBe(before); // the instance leaf followed the multi-drag (was static before this slice)
});

it('a group containing a symbol instance previews the instance’s leaf mid-drag (instance-in-group)', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  const inner = createVectorAsset('rect', { id: 'inner-asset' });
  const innerObj = createSceneObject('inner-asset', { id: 'inner', zOrder: 0, shapeBase: { width: 40, height: 40 } });
  const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj], width: 40, height: 40 });
  const instance = createSceneObject('sym-1', { id: 'inst', zOrder: 0, base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
  const leafAsset = createVectorAsset('rect', { id: 'leaf-asset' });
  const leafObj = createSceneObject('leaf-asset', { id: 'leaf', zOrder: 1, shapeBase: { width: 40, height: 40 }, base: { x: 100, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
  const project = createProject();
  project.assets = [inner, sym, leafAsset];
  project.objects = [instance, leafObj];
  act(() => {
    useEditor.getState().commit(project);
    useEditor.getState().selectObjects(['inst', 'leaf']);
    useEditor.getState().groupSelected();
    useEditor.getState().setSnapEnabled(false);
  });
  const nodes = new Map<string, SVGGraphicsElement>();
  nodes.set('leaf', document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  nodes.set('inst/inner', document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  render(<Stage nodes={nodes} />);
  const before = nodes.get('inst/inner')!.getAttribute('transform');
  fireEvent.pointerDown(screen.getByTestId('group-handle-se'), { clientX: 140, clientY: 40, button: 0 });
  fireEvent.pointerMove(window, { clientX: 280, clientY: 80 }); // 2x scale, not yet committed
  const during = nodes.get('inst/inner')!.getAttribute('transform');
  expect(during).not.toBe(before); // the instance's leaf is previewed (frozen before this fix)
  expect(during).toContain('scale(2'); // and at the correct 2x group scale, not just any change
  fireEvent.pointerUp(window, { clientX: 280, clientY: 80 });
});

it('a leaf-only group still previews its leaf mid-drag (parity)', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 40, height: 40 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 100, y: 0, width: 40, height: 40 });
  const b = useEditor.getState().selectedObjectId!;
  act(() => {
    useEditor.getState().selectObjects([a, b]);
    useEditor.getState().groupSelected();
    useEditor.getState().setSnapEnabled(false);
  });
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const o of useEditor.getState().history.present.objects) {
    if (o.isGroup) continue;
    nodes.set(o.id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  }
  render(<Stage nodes={nodes} />);
  const before = nodes.get(a)!.getAttribute('transform');
  fireEvent.pointerDown(screen.getByTestId('group-handle-se'), { clientX: 140, clientY: 40, button: 0 });
  fireEvent.pointerMove(window, { clientX: 280, clientY: 80 });
  expect(nodes.get(a)!.getAttribute('transform')).not.toBe(before); // leaf still previews
  fireEvent.pointerUp(window, { clientX: 280, clientY: 80 });
});
