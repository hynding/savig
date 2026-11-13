// Filters slice 2 (spec 2026-11-13-filters): store verbs, auto-key, keyframe selection plumbing.
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { createProject, createSceneObject, createSymbolAsset, createVectorAsset } from '@savig/engine';
import type { SceneObject } from '@savig/engine';
import { selectActiveObjects } from './selectors';

const st = () => store.getState();
const objects = (): SceneObject[] => selectActiveObjects(st());
const byId = (id: string) => objects().find((o) => o.id === id)!;
const rect = () => {
  st().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  return st().selectedObjectId!;
};
const setAutoKey = (on: boolean) => {
  if (st().autoKey !== on) st().toggleAutoKey();
};

beforeEach(() => {
  st().setProject(createProject());
  setAutoKey(true);
});

describe('filter verbs', () => {
  it('addFilter appends a defaulted filter in one undo step; nothing selected = no-op', () => {
    const id = rect();
    st().addFilter('glow');
    st().addFilter('blur');
    const fs = byId(id).filters!;
    expect(fs.map((f) => f.kind)).toEqual(['glow', 'blur']);
    expect(fs[0]).toMatchObject({ params: { blur: 6, strength: 1.5, opacity: 1 }, color: '#ffcc00' });
    st().undo();
    expect(byId(id).filters!.map((f) => f.kind)).toEqual(['glow']);
    st().selectObject(null);
    const before = st().history.present;
    st().addFilter('blur');
    expect(st().history.present).toBe(before);
  });

  it('moveFilter reorders; toggleFilter flips enabled (absent = on)', () => {
    const id = rect();
    st().addFilter('blur');
    st().addFilter('dropShadow');
    const [b, d] = byId(id).filters!;
    st().moveFilter(d.id, -1);
    expect(byId(id).filters!.map((f) => f.id)).toEqual([d.id, b.id]);
    st().moveFilter(d.id, -1); // already first: no-op
    expect(byId(id).filters!.map((f) => f.id)).toEqual([d.id, b.id]);
    st().toggleFilter(b.id);
    expect(byId(id).filters!.find((f) => f.id === b.id)!.enabled).toBe(false);
    st().toggleFilter(b.id);
    expect('enabled' in byId(id).filters!.find((f) => f.id === b.id)!).toBe(false);
  });

  it('setFilterParam: auto-key ON keyframes at the snapped playhead; OFF writes the static param; values clamp', () => {
    const id = rect();
    st().addFilter('blur');
    const f = byId(id).filters![0];
    st().seek(1);
    st().setFilterParam(f.id, 'blur', 12);
    expect(byId(id).filterTracks![`${f.id}.blur`].map((k) => [k.time, k.value])).toEqual([[1, 12]]);
    expect(byId(id).filters![0].params.blur).toBe(4);
    setAutoKey(false);
    st().setFilterParam(f.id, 'blur', 999);
    expect(byId(id).filters![0].params.blur).toBe(200);
    st().setFilterParam(f.id, 'nope', 1); // unknown param: no-op
    expect(byId(id).filters![0].params).toEqual({ blur: 200 });
  });

  it('setFilterColor only for colored kinds; removeFilter drops its tracks and keyframe selection', () => {
    const id = rect();
    st().addFilter('blur');
    st().addFilter('dropShadow');
    const [b, d] = byId(id).filters!;
    st().setFilterColor(b.id, '#ff0000');
    expect(byId(id).filters![0].color).toBeUndefined();
    st().setFilterColor(d.id, '#ff0000');
    expect(byId(id).filters![1].color).toBe('#ff0000');
    st().setFilterParam(d.id, 'dx', 9);
    st().selectFilterKeyframe({ objectId: id, key: `${d.id}.dx`, time: 0 });
    st().removeFilter(d.id);
    expect(byId(id).filters!.map((f) => f.id)).toEqual([b.id]);
    expect(byId(id).filterTracks).toBeUndefined();
    expect(st().selectedFilterKeyframe).toBeNull();
    st().removeFilter(b.id);
    expect('filters' in byId(id)).toBe(false);
  });

  it('works on a group and inside an edited symbol (active scene)', () => {
    const a = rect();
    const b = rect();
    st().selectObjects([a, b]);
    st().groupSelected();
    const g = st().selectedObjectId!;
    st().addFilter('blur');
    expect(byId(g).filters).toHaveLength(1);

    st().setProject(createProject());
    st().addAsset(createVectorAsset('rect', { id: 'va' }));
    st().addAsset(createSymbolAsset({ id: 'S', objects: [createSceneObject('va', { id: 'inner' })] }));
    st().enterSymbol('S');
    st().selectObject('inner');
    st().addFilter('glow');
    expect(byId('inner').filters![0].kind).toBe('glow');
    expect(st().history.present.objects).toHaveLength(0);
  });
});

describe('filter keyframes', () => {
  function animated() {
    const id = rect();
    st().addFilter('blur');
    const f = byId(id).filters![0];
    st().setFilterParam(f.id, 'blur', 0);
    st().seek(1);
    st().setFilterParam(f.id, 'blur', 8);
    return { id, key: `${f.id}.blur` };
  }

  it('select is exclusive with other keyframe kinds; delete removes the keyframe (and the empty track)', () => {
    const { id, key } = animated();
    st().selectKeyframe({ objectId: id, property: 'x', time: 0 });
    st().selectFilterKeyframe({ objectId: id, key, time: 1 });
    expect(st().selectedKeyframe).toBeNull();
    st().deleteSelectedKeyframe();
    expect(byId(id).filterTracks![key].map((k) => k.time)).toEqual([0]);
    st().selectFilterKeyframe({ objectId: id, key, time: 0 });
    st().removeSelectedFilterKeyframe();
    expect(byId(id).filterTracks).toBeUndefined();
  });

  it('retime, easing and copy/paste', () => {
    const { id, key } = animated();
    st().selectFilterKeyframe({ objectId: id, key, time: 1 });
    st().retimeSelectedKeyframe(2);
    expect(byId(id).filterTracks![key].map((k) => k.time)).toEqual([0, 2]);
    expect(st().selectedFilterKeyframe).toEqual({ objectId: id, key, time: 2 });
    st().setSelectedKeyframeEasing('easeIn');
    expect(byId(id).filterTracks![key][1].easing).toBe('easeIn');
    st().copyKeyframe();
    st().seek(1.5);
    st().pasteKeyframe();
    expect(byId(id).filterTracks![key].map((k) => [k.time, k.value])).toEqual([[0, 0], [1.5, 8], [2, 8]]);
    expect(st().selectedFilterKeyframe).toEqual({ objectId: id, key, time: 1.5 });
  });
});
