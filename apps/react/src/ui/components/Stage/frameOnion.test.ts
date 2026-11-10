// Frame-by-frame onion skin (slice 4): whole-drawing ghosts of the neighbouring keys.
import { createFrameLayer, createGroupObject, createProject, createSceneObject, createVectorAsset } from '@savig/engine';
import type { Project, SceneObject } from '@savig/engine';
import { frameOnionGhosts } from './frameOnion';

const rect = createVectorAsset('rect', { id: 'rect' });
const path = createVectorAsset('path', { id: 'path', path: { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 10 } }], closed: true } });
const svg = { id: 'svg', kind: 'svg' as const, name: 'svg', normalizedContent: '<g/>', viewBox: '0 0 1 1', width: 1, height: 1 };

/** Layer L: a@0 (rect A), b@0.2 (blank), c@0.4 (group G holding path P), d@0.6 (svg S), end 1. */
function scene(): { project: Project; layer: SceneObject } {
  const layer = createFrameLayer({
    id: 'L',
    zOrder: 0,
    keys: [{ id: 'a', time: 0 }, { id: 'b', time: 0.2 }, { id: 'c', time: 0.4 }, { id: 'd', time: 0.6 }],
    end: 1,
  });
  const objects: SceneObject[] = [
    layer,
    createSceneObject('rect', { id: 'A', zOrder: 0, parentId: 'L', frameKeyId: 'a', base: { x: 5, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } }),
    { ...createGroupObject({ id: 'G', zOrder: 0, anchorX: 0, anchorY: 0 }), parentId: 'L', frameKeyId: 'c' },
    createSceneObject('path', { id: 'P', zOrder: 0, parentId: 'G' }),
    createSceneObject('svg', { id: 'S', zOrder: 0, parentId: 'L', frameKeyId: 'd' }),
    createSceneObject('rect', { id: 'X', zOrder: 1 }), // outside the layer: never ghosted
  ];
  return { project: { ...createProject({ fps: 10 }), assets: [rect, path, svg], objects }, layer };
}

describe('frameOnionGhosts', () => {
  it('ghosts the nearest drawn keys either side, skipping blank keys and the current key', () => {
    const { project, layer } = scene();
    const ghosts = frameOnionGhosts(project, layer, 0.45, 2); // key c is on screen
    expect(ghosts.map((g) => [g.side, g.rank, g.keyId, g.time])).toEqual([
      ['before', 0, 'a', 0], // b is blank → skipped
      ['after', 0, 'd', 0.6],
    ]);
    const before = ghosts[0].shapes;
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ id: 'A', tag: 'rect' });
    expect(before[0].transform).toContain('translate(5');
    expect(ghosts[1].shapes).toEqual([]); // an svg drawing has no cheap outline
  });

  it('ghosts drawings nested in a group inside the key, as paths', () => {
    const { project, layer } = scene();
    const ghosts = frameOnionGhosts(project, layer, 0.1, 1);
    expect(ghosts.map((g) => g.keyId)).toEqual(['c']);
    expect(ghosts[0].shapes).toEqual([expect.objectContaining({ id: 'P', tag: 'path', attrs: { d: expect.stringMatching(/^M/) } })]);
  });

  it('returns nothing for an ordinary group', () => {
    const { project } = scene();
    expect(frameOnionGhosts(project, project.objects.find((o) => o.id === 'G')!, 0, 2)).toEqual([]);
  });
});
