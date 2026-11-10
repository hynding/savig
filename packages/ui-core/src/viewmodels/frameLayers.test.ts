// Frame-by-frame slice 3 (spec 2026-11-07 §Timeline, §Layers panel, §Selection): the timeline
// frame strip VM, Layers scoping to the exposed key, and marquee skipping hidden drawings.
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '@savig/editor-state';
import { createFrameLayer, createProject, createSceneObject } from '@savig/engine';
import type { SvgAsset } from '@savig/engine';
import { timelineViewModel, timelineIntents } from './timeline';
import { layersPanelViewModel } from './layersPanel';
import { makeMarqueeController, type Point } from '../controllers/marqueeSelect';

const FPS = 10;
const f = (n: number) => n / FPS;
const box: SvgAsset = { id: 'box', kind: 'svg', name: 'box', normalizedContent: '<svg/>', viewBox: '0 0 20 20', width: 20, height: 20 };

/** Root `R` (ordinary), then layer `L` with keys a@0 (drawing `A`), b@3 (blank), c@6 (drawing
 *  `C`, labelled "walk"), end 1s. Children are listed BEFORE the layer to prove row grouping. */
function seed() {
  const L = createFrameLayer({
    id: 'L',
    name: 'Layer',
    zOrder: 1,
    keys: [{ id: 'a', time: 0 }, { id: 'b', time: f(3) }, { id: 'c', time: f(6), label: 'walk' }],
    end: 1,
  });
  store.getState().setProject({
    ...createProject({ fps: FPS, duration: 2, durationMode: 'manual' }),
    assets: [box],
    objects: [
      createSceneObject('box', { id: 'A', name: 'A', zOrder: 0, parentId: 'L', frameKeyId: 'a' }),
      createSceneObject('box', { id: 'R', name: 'R', zOrder: 0 }),
      createSceneObject('box', { id: 'C', name: 'C', zOrder: 1, parentId: 'L', frameKeyId: 'c' }),
      L,
    ],
  });
}

beforeEach(seed);
const st = () => store.getState();

describe('timeline frame strip', () => {
  it('gives the layer row a strip of keys with spans, blank flags, labels and the current key', () => {
    st().seek(f(4));
    const row = timelineViewModel(st()).rows.find((r) => r.id === 'L')!;
    expect(row.frameLayer?.end).toBe(1);
    expect(row.frameLayer?.keys).toEqual([
      { id: 'a', time: 0, end: f(3), blank: false, current: false },
      { id: 'b', time: f(3), end: f(6), blank: true, current: true },
      { id: 'c', time: f(6), end: 1, blank: false, label: 'walk', current: false },
    ]);
    expect(row.frameLayer?.targeted).toBe(false);
    st().selectObject('C'); // a drawing in the layer targets it
    expect(timelineViewModel(st()).rows.find((r) => r.id === 'L')!.frameLayer?.targeted).toBe(true);
  });

  it('lists a layer’s children right after it, flagged with their owner and exposure', () => {
    const vm = timelineViewModel(st());
    expect(vm.rows.map((r) => r.id)).toEqual(['R', 'L', 'A', 'C']);
    const byId = new Map(vm.rows.map((r) => [r.id, r] as const));
    expect(byId.get('R')).toMatchObject({ frameOwnerIds: [], exposed: true });
    expect(byId.get('R')!.frameLayer).toBeUndefined();
    expect(byId.get('A')).toMatchObject({ frameOwnerIds: ['L'], exposed: true });
    expect(byId.get('C')).toMatchObject({ frameOwnerIds: ['L'], exposed: false });
  });

  it('targetFrameCell selects the layer and seeks; keeps a selected drawing', () => {
    const i = timelineIntents(store);
    i.targetFrameCell('L', f(7));
    expect(st().selectedObjectId).toBe('L');
    expect(st().time).toBeCloseTo(f(7));
    st().selectObject('C');
    i.targetFrameCell('L', f(8));
    expect(st().selectedObjectId).toBe('C');
  });

  it('targetFrameCell may pick an empty cell past the end of an auto-length project', () => {
    store.getState().setProject({
      ...st().history.present,
      meta: { ...st().history.present.meta, durationMode: 'auto' },
    });
    timelineIntents(store).targetFrameCell('L', 1.5);
    expect(st().time).toBeCloseTo(1.5);
    st().seek(1.5); // ordinary seeks still clamp to the (1s) duration
    expect(st().time).toBeCloseTo(1);
  });

  it('strip intents drive the verbs on the targeted layer', () => {
    const i = timelineIntents(store);
    i.targetFrameCell('L', f(6));
    i.setFrameKeyLabel('c', 'run');
    i.moveFrameKeyTo('c', f(8));
    const keys = st().history.present.objects.find((o) => o.id === 'L')!.frames!.keys;
    expect(keys.find((k) => k.id === 'c')).toEqual({ id: 'c', time: f(8), label: 'run' });
    i.targetFrameCell('L', f(1));
    i.insertFrames();
    expect(st().history.present.objects.find((o) => o.id === 'L')!.frames!.keys.map((k) => k.time)).toEqual([0, f(4), f(9)]);
  });
});

describe('layers panel scoping', () => {
  it('lists only the exposed key’s drawing under the layer, with a frame caption', () => {
    let vm = layersPanelViewModel(st());
    expect(vm.rows.map((r) => r.id)).toEqual(['L', 'A', 'R']);
    expect(vm.rows[0].frameCaption).toBe('Frame 1');
    st().seek(f(7));
    vm = layersPanelViewModel(st());
    expect(vm.rows.map((r) => r.id)).toEqual(['L', 'C', 'R']);
    expect(vm.rows[0].frameCaption).toBe('Frame 7 · walk');
    st().seek(f(4)); // blank key: the layer has no children listed
    vm = layersPanelViewModel(st());
    expect(vm.rows.map((r) => r.id)).toEqual(['L', 'R']);
    expect(vm.rows[0].frameCaption).toBe('Frame 4');
    expect(vm.rows.find((r) => r.id === 'R')!.frameCaption).toBeUndefined();
  });

  it('captions "No frame" past the end', () => {
    st().seek(1.5);
    const vm = layersPanelViewModel(st());
    expect(vm.rows[0].frameCaption).toBe('No frame');
    expect(vm.rows.map((r) => r.id)).toEqual(['L', 'R']);
  });
});

describe('marquee', () => {
  const at = (p: Point) => (): Point => p;
  it('selects only the drawing exposed at the playhead (and that drawing, not the layer)', () => {
    const c = makeMarqueeController(store);
    c.beginSelect(0, at({ x: -5, y: -5 }), false);
    c.move(at({ x: 30, y: 30 }));
    c.end();
    expect([...st().selectedObjectIds].sort()).toEqual(['A', 'R']);
  });
});
