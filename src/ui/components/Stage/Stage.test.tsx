import { render, screen, fireEvent } from '@testing-library/react';
import { Stage } from './Stage';
import { useEditor } from '../../store/store';
import { sampleObject, pathToD } from '../../../engine';

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
