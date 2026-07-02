// Pure unit tests for `layersPanelViewModel` — no React. Drives the real vanilla
// `@savig/editor-state` store through its actions (same store the app uses) and asserts on
// the resulting descriptor, mirroring how `LayersPanel.tsx` consumes it at runtime.
import { store } from '@savig/editor-state';
import { createProject, createSceneObject, createSymbolAsset, createVectorAsset } from '@savig/engine';
import { layersPanelViewModel } from './layersPanel';

beforeEach(() => {
  store.getState().newProject();
});

function twoRects() {
  store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 0
  store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 1 (front)
}

describe('layersPanelViewModel — front-first ordering & selection', () => {
  it('lists top-level objects front-first (highest zOrder first), each at depth 0', () => {
    twoRects();
    const objs = store.getState().history.present.objects;
    const front = objs.find((o) => o.zOrder === 1)!;
    const back = objs.find((o) => o.zOrder === 0)!;

    const vm = layersPanelViewModel(store.getState());
    expect(vm.rows.map((r) => r.id)).toEqual([front.id, back.id]);
    expect(vm.rows.every((r) => r.depth === 0)).toBe(true);
    expect(vm.rows.every((r) => r.parentId === null)).toBe(true);
  });

  it('marks the selected row (and only that one) as selected', () => {
    twoRects();
    const objs = store.getState().history.present.objects;
    const back = objs.find((o) => o.zOrder === 0)!;
    const front = objs.find((o) => o.zOrder === 1)!; // selected after twoRects
    store.getState().selectObject(back.id);

    const vm = layersPanelViewModel(store.getState());
    expect(vm.rows.find((r) => r.id === back.id)?.selected).toBe(true);
    expect(vm.rows.find((r) => r.id === front.id)?.selected).toBe(false);
  });
});

describe('layersPanelViewModel — visibility & lock (own vs. cascade)', () => {
  it('toggling visibility sets `hidden` on that row only', () => {
    twoRects();
    const objs = store.getState().history.present.objects;
    const back = objs.find((o) => o.zOrder === 0)!;
    const front = objs.find((o) => o.zOrder === 1)!;
    store.getState().toggleObjectVisibility(back.id);

    const vm = layersPanelViewModel(store.getState());
    expect(vm.rows.find((r) => r.id === back.id)?.hidden).toBe(true);
    expect(vm.rows.find((r) => r.id === front.id)?.hidden).toBe(false);
  });

  it('a directly-locked leaf: both ownLocked and locked are true', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = store.getState().selectedObjectId!;
    store.getState().toggleObjectLock(id);

    const vm = layersPanelViewModel(store.getState());
    const row = vm.rows.find((r) => r.id === id)!;
    expect(row.ownLocked).toBe(true);
    expect(row.locked).toBe(true);
  });

  it('own lock drives `ownLocked`; an ancestor group\'s lock cascades into `locked` without setting `ownLocked`', () => {
    twoRects();
    const objs = store.getState().history.present.objects;
    const [a, b] = objs.map((o) => o.id);
    store.getState().selectObjects([a, b]);
    store.getState().groupSelected();
    const groupId = store.getState().selectedObjectId!;
    store.getState().toggleObjectLock(groupId);

    const vm = layersPanelViewModel(store.getState());
    const child = vm.rows.find((r) => r.id === a)!;
    expect(child.ownLocked).toBe(false); // the child itself was never directly locked
    expect(child.locked).toBe(true); // cascades from the locked ancestor group
    const group = vm.rows.find((r) => r.id === groupId)!;
    expect(group.ownLocked).toBe(true);
    expect(group.locked).toBe(true);
  });
});

describe('layersPanelViewModel — group nesting', () => {
  function buildNested() {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = store.getState().selectedObjectId!;
    store.getState().addVectorShape('rect', { x: 20, y: 0, width: 10, height: 10 });
    const b = store.getState().selectedObjectId!;
    store.getState().addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
    const c = store.getState().selectedObjectId!;
    store.getState().selectObjects([a, b]);
    store.getState().groupSelected();
    const inner = store.getState().selectedObjectId!;
    store.getState().selectObjects([inner, c]);
    store.getState().groupSelected();
    const outer = store.getState().selectedObjectId!;
    return { a, b, c, inner, outer };
  }

  it('reports isGroup for group containers only, and nests grandchildren at depth 2 with the right parentId chain', () => {
    const { a, b, c, inner, outer } = buildNested();

    const vm = layersPanelViewModel(store.getState());
    const row = (id: string) => vm.rows.find((r) => r.id === id)!;

    expect(row(outer).isGroup).toBe(true);
    expect(row(outer).depth).toBe(0);
    expect(row(outer).parentId).toBeNull();

    expect(row(inner).isGroup).toBe(true);
    expect(row(inner).depth).toBe(1);
    expect(row(inner).parentId).toBe(outer);

    expect(row(c).isGroup).toBe(false);
    expect(row(c).depth).toBe(1);
    expect(row(c).parentId).toBe(outer);

    expect(row(a).isGroup).toBe(false);
    expect(row(a).depth).toBe(2); // grandchild
    expect(row(a).parentId).toBe(inner);
    expect(row(b).depth).toBe(2);
    expect(row(b).parentId).toBe(inner);
  });

  it('returns the FULL tree regardless of any (component-local) collapse state — no collapse concept here', () => {
    const { a, b, c, inner, outer } = buildNested();
    const vm = layersPanelViewModel(store.getState());
    // All 5 objects are present as rows; collapsing is a render-time filter the component applies.
    expect(vm.rows.map((r) => r.id).sort()).toEqual([a, b, c, inner, outer].sort());
  });
});

describe('layersPanelViewModel — symbol edit mode', () => {
  it('shows the active symbol scene rows, not the root project rows, while editing a symbol', () => {
    const s = store.getState();
    s.newProject();
    const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
    const innerObj = createSceneObject('inner-asset', { id: 'inner', name: 'inner-layer', zOrder: 0 });
    const sym = createSymbolAsset({ id: 'sym', objects: [innerObj], width: 10, height: 10 });
    const p = createProject();
    p.assets = [inner, sym];
    p.objects = [createSceneObject('sym', { id: 'a', name: 'inst-layer' })];
    s.commit(p);
    s.enterSymbol('sym');

    const vm = layersPanelViewModel(store.getState());
    expect(vm.rows.map((r) => r.name)).toEqual(['inner-layer']);
  });
});
