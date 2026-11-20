import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import type { VectorAsset } from '@savig/engine';

beforeEach(() => {
  store.getState().newProject();
});

function seedRect(): string {
  store.getState().addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
  return store.getState().selectedObjectId!;
}

const project = () => store.getState().history.present;
const style = (objectId: string) => {
  const o = project().objects.find((x) => x.id === objectId)!;
  return (project().assets.find((a) => a.id === o.assetId) as VectorAsset).style;
};

describe('swatch slice', () => {
  it('addSwatch seeds from the selected fill and is one undo step', () => {
    const id = seedRect();
    store.getState().setVectorStyle({ fill: '#FF8800' });
    const sw = store.getState().addSwatch();
    expect(project().swatches).toEqual([{ id: sw, name: '#ff8800', color: '#ff8800' }]);
    store.getState().undo();
    expect(project().swatches).toBeUndefined();
    expect(style(id).fill).toBe('#FF8800');
  });

  it('addSwatch with nothing selected uses grey; an explicit colour wins', () => {
    store.getState().addSwatch();
    store.getState().addSwatch('#00f', { name: 'Blue', global: true });
    expect(project().swatches!.map((s) => [s.name, s.color, !!s.global])).toEqual([
      ['#888888', '#888888', false],
      ['Blue', '#0000ff', true],
    ]);
  });

  it('applySwatch paints every selected shape and editing a global swatch recolours them', () => {
    const a = seedRect();
    const b = seedRect();
    const sw = store.getState().addSwatch('#123456', { global: true });
    store.getState().selectObjects([a, b]);
    store.getState().applySwatch(sw, 'fill');
    expect(style(a).fill).toBe('#123456');
    expect(style(b).fillSwatch).toBe(sw);

    store.getState().updateSwatch(sw, { color: '#abcdef' });
    expect(style(a).fill).toBe('#abcdef');
    expect(style(b).fill).toBe('#abcdef');
    store.getState().undo();
    expect(style(a).fill).toBe('#123456');
  });

  it('an Inspector recolour unlinks the shape from the global swatch', () => {
    const a = seedRect();
    const sw = store.getState().addSwatch('#123456', { global: true });
    store.getState().applySwatch(sw, 'stroke');
    store.getState().setVectorStyle({ stroke: '#000000' });
    store.getState().updateSwatch(sw, { color: '#ffffff' });
    expect(style(a).stroke).toBe('#000000');
  });

  it('applySwatch skips locked objects and keys keyed colours at the playhead', () => {
    const a = seedRect();
    const sw = store.getState().addSwatch('#123456');
    store.getState().toggleObjectLock(a);
    store.getState().applySwatch(sw, 'fill');
    expect(style(a).fill).not.toBe('#123456');
    store.getState().toggleObjectLock(a);

    store.setState({ autoKey: true });
    store.getState().selectObject(a);
    store.getState().setVectorColor('fill', '#ff0000');
    store.getState().applySwatch(sw, 'fill');
    const o = project().objects.find((x) => x.id === a)!;
    expect(o.colorTracks!.fill![0].value).toBe('#123456');
    expect(style(a).fill).toBe('#123456');
  });

  it('removeSwatch / moveSwatch / invalid colour', () => {
    const s1 = store.getState().addSwatch('#111111');
    const s2 = store.getState().addSwatch('#222222');
    store.getState().moveSwatch(s2, 0);
    expect(project().swatches!.map((s) => s.id)).toEqual([s2, s1]);
    const before = project();
    store.getState().updateSwatch(s1, { color: 'nope' });
    expect(project()).toBe(before);
    store.getState().removeSwatch(s1);
    store.getState().removeSwatch(s2);
    expect(project().swatches).toBeUndefined();
  });
});
