import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { createProject, createSceneObject, createVectorAsset, createSymbolAsset } from '@savig/engine';
import type { VectorAsset, Gradient } from '@savig/engine';

beforeEach(() => {
  store.getState().newProject();
  // styleClipboard deliberately survives newProject (mirrors clipboard/keyframeClipboard — see
  // case 9), so it must be reset explicitly here for test isolation across this file.
  store.setState({ styleClipboard: null });
});

function seedRect(): string {
  const s = store.getState();
  s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
  return store.getState().selectedObjectId!;
}

const obj = (id: string) => store.getState().history.present.objects.find((o) => o.id === id)!;
const asset = (id: string): VectorAsset => {
  const a = store.getState().history.present.assets.find((x) => x.id === obj(id).assetId)!;
  if (a.kind !== 'vector') throw new Error('not vector');
  return a;
};

const gradient: Gradient = {
  type: 'linear',
  x1: 0,
  y1: 0,
  x2: 1,
  y2: 1,
  stops: [
    { offset: 0, color: '#ffffff' },
    { offset: 1, color: '#000000' },
  ],
};

describe('copyStyle', () => {
  it('case 1: captures the selected vector\'s asset style as a deep clone (mutating the asset afterwards does not affect the clipboard)', () => {
    const id = seedRect();
    store.getState().copyStyle();
    const captured = store.getState().styleClipboard;
    expect(captured).toEqual(asset(id).style);
    expect(captured).not.toBe(asset(id).style); // structuredClone, not a reference

    store.getState().setVectorStyle({ fill: '#ff0000' });
    expect(asset(id).style.fill).toBe('#ff0000'); // asset did change
    expect(store.getState().styleClipboard).toEqual(captured); // clipboard untouched
  });

  it('case 2a: no selection leaves styleClipboard null', () => {
    seedRect();
    store.getState().selectObject(null);
    store.getState().copyStyle();
    expect(store.getState().styleClipboard).toBeNull();
  });

  it('case 2b: a group selected leaves styleClipboard null', () => {
    const id1 = seedRect();
    const id2 = seedRect();
    store.getState().selectObjects([id1, id2]);
    store.getState().groupSelected();
    store.getState().copyStyle();
    expect(store.getState().styleClipboard).toBeNull();
  });

  it('case 10: captures the playhead-SAMPLED fill, not the stale static asset style, when autoKey recolored into colorTracks', () => {
    const id = seedRect(); // autoKey ON by default
    store.getState().setVectorColor('fill', '#ff0000'); // -> colorTracks.fill at t=0, asset.style.fill unchanged
    expect(obj(id).colorTracks?.fill).toBeDefined();
    expect(asset(id).style.fill).not.toBe('#ff0000'); // still the stale static default

    store.getState().seek(0); // playhead sits on the recolor keyframe
    store.getState().copyStyle();

    expect(store.getState().styleClipboard?.fill).toBe('#ff0000'); // sampled, not stale
  });
});

describe('pasteStyle', () => {
  it('case 3: replaces the target asset style verbatim, including gradients', () => {
    const sourceId = seedRect();
    store.getState().toggleAutoKey(); // OFF, so the gradient writes to the static asset style
    store.getState().setVectorGradient('fill', gradient);
    store.getState().copyStyle();

    const targetId = seedRect();
    store.getState().selectObject(targetId);
    store.getState().pasteStyle();

    expect(asset(targetId).style).toEqual(asset(sourceId).style);
    expect(asset(targetId).style.fillGradient).toEqual(gradient);
  });

  it('case 4: WYSIWYG clearing — colorTracks.fill + gradientTracks.stroke + dashOffsetTrack are all cleared in the SAME history entry as the style replacement', () => {
    seedRect(); // source
    store.getState().copyStyle();

    const targetId = seedRect();
    store.getState().selectObject(targetId);
    store.getState().setVectorColor('fill', '#ff0000'); // autoKey ON by default -> colorTracks.fill
    store.getState().setVectorGradient('stroke', gradient); // -> gradientTracks.stroke
    store.getState().setStrokeDashoffset(0.4); // -> dashOffsetTrack
    expect(obj(targetId).colorTracks?.fill).toBeDefined();
    expect(obj(targetId).gradientTracks?.stroke).toBeDefined();
    expect(obj(targetId).dashOffsetTrack).toBeDefined();

    const pastLen = store.getState().history.past.length;
    store.getState().pasteStyle();
    expect(obj(targetId).colorTracks).toBeUndefined();
    expect(obj(targetId).gradientTracks).toBeUndefined();
    expect(obj(targetId).dashOffsetTrack).toBeUndefined();
    expect(store.getState().history.past.length).toBe(pastLen + 1); // one commit

    store.getState().undo(); // one undo restores style AND tracks
    expect(obj(targetId).colorTracks?.fill).toBeDefined();
    expect(obj(targetId).gradientTracks?.stroke).toBeDefined();
    expect(obj(targetId).dashOffsetTrack).toBeDefined();
  });

  it('case 5: trim-target skip — a target with obj.trim omits strokeDasharray/strokeDashoffset from the pasted style; trim is untouched', () => {
    const sourceId = seedRect();
    store.getState().setVectorStyle({ strokeDasharray: [1, 1], strokeDashoffset: 0.25 });
    store.getState().copyStyle();

    const targetId = seedRect();
    store.getState().selectObject(targetId);
    store.getState().toggleAutoKey(); // OFF, so setTrim writes a plain base trim
    store.getState().setTrim('end', 0.5);
    const trimBefore = obj(targetId).trim;
    expect(trimBefore).toBeDefined();

    store.getState().pasteStyle();
    const style = asset(targetId).style;
    expect(style.strokeDasharray).toBeUndefined();
    expect(style.strokeDashoffset).toBeUndefined();
    expect('strokeDasharray' in style).toBe(false);
    expect('strokeDashoffset' in style).toBe(false);
    // everything else pastes through
    expect(style.fill).toBe(asset(sourceId).style.fill);
    expect(style.stroke).toBe(asset(sourceId).style.stroke);
    expect(style.strokeWidth).toBe(asset(sourceId).style.strokeWidth);
    // trim untouched
    expect(obj(targetId).trim).toEqual(trimBefore);
  });

  it('case 6: multi-select restyles both vectors and leaves a selected group untouched, in ONE history entry', () => {
    seedRect(); // source
    store.getState().setVectorStyle({ fill: '#123456' });
    store.getState().copyStyle();

    const v1 = seedRect();
    const v2 = seedRect();
    const g1 = seedRect();
    const g2 = seedRect();
    store.getState().selectObjects([g1, g2]);
    store.getState().groupSelected();
    const groupId = store.getState().selectedObjectId!;

    store.getState().selectObjects([v1, v2, groupId]);
    const pastLen = store.getState().history.past.length;
    store.getState().pasteStyle();

    expect(asset(v1).style.fill).toBe('#123456');
    expect(asset(v2).style.fill).toBe('#123456');
    expect(store.getState().history.present.objects.find((o) => o.id === groupId)?.isGroup).toBe(true);
    expect(store.getState().history.past.length).toBe(pastLen + 1); // one commit for both vectors
  });

  it('case 7a: no-op (no history entry) when only a group is selected', () => {
    seedRect(); // source
    store.getState().copyStyle();

    const g1 = seedRect();
    const g2 = seedRect();
    store.getState().selectObjects([g1, g2]);
    store.getState().groupSelected();

    const pastLen = store.getState().history.past.length;
    store.getState().pasteStyle();
    expect(store.getState().history.past.length).toBe(pastLen);
  });

  it('case 7b: no-op (no history entry) with an empty clipboard', () => {
    const id = seedRect();
    store.getState().selectObject(id);
    expect(store.getState().styleClipboard).toBeNull();

    const pastLen = store.getState().history.past.length;
    store.getState().pasteStyle();
    expect(store.getState().history.past.length).toBe(pastLen);
  });
});

describe('applyStyleFrom', () => {
  it('case 8a: with a selection, restyles it from the source object in one commit', () => {
    const sourceId = seedRect();
    store.getState().setVectorStyle({ fill: '#abcdef' });

    const targetId = seedRect();
    store.getState().selectObject(targetId);
    const pastLen = store.getState().history.past.length;
    store.getState().applyStyleFrom(sourceId);

    expect(asset(targetId).style.fill).toBe('#abcdef');
    expect(store.getState().history.past.length).toBe(pastLen + 1);
  });

  it('case 8b: with an empty selection, sets the style clipboard from the source instead, with no commit', () => {
    const sourceId = seedRect();
    store.getState().setVectorStyle({ fill: '#abcdef' });
    store.getState().selectObject(null);

    const pastLen = store.getState().history.past.length;
    store.getState().applyStyleFrom(sourceId);

    expect(store.getState().styleClipboard).toEqual(asset(sourceId).style);
    expect(store.getState().history.past.length).toBe(pastLen);
  });

  it('case 8c: paste-to-selection applies the playhead-SAMPLED fill from a source with an autoKey colorTrack, not the stale static style', () => {
    const sourceId = seedRect(); // autoKey ON by default
    store.getState().setVectorColor('fill', '#00ff00'); // -> colorTracks.fill, asset.style.fill stale
    store.getState().seek(0);

    const targetId = seedRect();
    store.getState().selectObject(targetId);
    store.getState().applyStyleFrom(sourceId);

    expect(asset(targetId).style.fill).toBe('#00ff00'); // target ends up with the VISIBLE color
  });
});

describe('pasteStyle inside a symbol scope', () => {
  function symbolWithRect() {
    const s = store.getState();
    s.newProject();
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const rectObj = createSceneObject('rect-asset', { id: 'r', zOrder: 0 });
    rectObj.shapeBase = { width: 10, height: 10 };
    const sym = createSymbolAsset({ id: 'sym', objects: [rectObj], width: 10, height: 10 });
    const p = createProject();
    p.assets = [rectAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' }), createSceneObject('sym', { id: 'inst2' })];
    s.commit(p);
    s.enterSymbol('sym');
    s.selectObject('r');
  }

  it('case 9: pasteStyle restyles the symbol\'s internal object, not root, using fresh state reads', () => {
    // Seed a distinctive style into the clipboard BEFORE entering the symbol; styleClipboard
    // survives newProject (mirrors clipboard/keyframeClipboard), so it's still there after
    // symbolWithRect() rebuilds the project.
    seedRect();
    store.getState().setVectorStyle({ fill: '#ff00ff', stroke: '#111111', strokeWidth: 5 });
    store.getState().copyStyle();
    const clip = store.getState().styleClipboard;
    expect(clip).not.toBeNull();

    symbolWithRect();
    expect(store.getState().styleClipboard).toEqual(clip); // survived newProject

    store.getState().pasteStyle();

    const rectAsset = store.getState().history.present.assets.find((a) => a.id === 'rect-asset') as VectorAsset;
    expect(rectAsset.style).toEqual(clip);
    expect(store.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1', 'inst2']); // root untouched
  });
});
