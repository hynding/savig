import { applyFrame } from './applyFrame';
import { buildTransform, createProject, createSceneObject, createKeyframe } from '../../engine';

it('writes the sampled transform + opacity to the matching node', () => {
  const obj = createSceneObject('a', {
    id: 'o1', anchorX: 0, anchorY: 0,
    tracks: { x: [createKeyframe(0, 0), createKeyframe(1, 100)] },
  });
  const project = { ...createProject(), objects: [obj] };

  const ns = 'http://www.w3.org/2000/svg';
  const node = document.createElementNS(ns, 'g') as SVGGraphicsElement;
  const nodes = new Map<string, SVGGraphicsElement>([['o1', node]]);

  applyFrame(nodes, project, 0.5);

  expect(node.getAttribute('transform')).toBe(
    buildTransform({ x: 50, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, 0, 0),
  );
  expect(node.getAttribute('opacity')).toBe('1');
});

it('ignores objects with no registered node', () => {
  const project = { ...createProject(), objects: [createSceneObject('a', { id: 'missing' })] };
  expect(() => applyFrame(new Map(), project, 0)).not.toThrow();
});
