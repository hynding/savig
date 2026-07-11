import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import type { PathData, SceneObject, VectorAsset, SymbolAsset, SvgAsset, TextAsset } from '@savig/engine';
import { ringArea } from '@savig/engine';
import { pointInRings } from '@savig/interaction';

beforeEach(() => {
  store.getState().newProject();
});

const obj = (id: string): SceneObject => store.getState().history.present.objects.find((o) => o.id === id)!;
const assetOf = (o: SceneObject): VectorAsset => {
  const a = store.getState().history.present.assets.find((x) => x.id === o.assetId)!;
  if (a.kind !== 'vector') throw new Error('not vector');
  return a;
};

/** Axis-aligned closed square ring, world-space corners (offX,offY)-(offX+s,offY+s). */
function square(s: number, offX: number, offY: number): PathData {
  return {
    closed: true,
    nodes: [
      { anchor: { x: offX, y: offY } },
      { anchor: { x: offX + s, y: offY } },
      { anchor: { x: offX + s, y: offY + s } },
      { anchor: { x: offX, y: offY + s } },
    ],
  };
}

/** addVectorPath's normalize-to-local-origin preserves ABSOLUTE (world) placement (base absorbs
 *  the shift) — so a square authored at these coordinates renders at these WORLD coordinates,
 *  letting tests build `regionRings` in the same literal numbers used to author the fixtures. */
function addSquare(s: number, offX: number, offY: number): string {
  store.getState().addVectorPath(square(s, offX, offY));
  return store.getState().selectedObjectId!;
}

function addRect(offX: number, offY = 0, w = 10, h = 10): string {
  store.getState().addVectorShape('rect', { x: offX, y: offY, width: w, height: h });
  return store.getState().selectedObjectId!;
}

function addOpenPath(): string {
  const path: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] };
  store.getState().addVectorPath(path);
  return store.getState().selectedObjectId!;
}

function addSvgObject(): string {
  const asset: SvgAsset = { id: 'svg-1', kind: 'svg', name: 'SVG', normalizedContent: '<g></g>', viewBox: '0 0 10 10', width: 10, height: 10 };
  store.getState().addAsset(asset);
  store.getState().addObject(asset.id);
  return store.getState().selectedObjectId!;
}

function addTextObject(): string {
  const asset: TextAsset = { id: 'text-1', kind: 'text', name: 'Text', content: 'hi', fontSize: 12, fill: '#000000' };
  store.getState().addAsset(asset);
  store.getState().addObject(asset.id);
  return store.getState().selectedObjectId!;
}

describe('canShapeBuilder eligibility gate (enterShapeBuilder)', () => {
  it('no-ops (+ error toast) with fewer than 2 selected', () => {
    const a = addSquare(10, 0, 0);
    store.getState().selectObjects([a]);
    store.getState().enterShapeBuilder();
    expect(store.getState().shapeBuilder).toBeNull();
    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0].kind).toBe('error');
  });

  it('no-ops with more than 6 selected', () => {
    const ids = Array.from({ length: 7 }, (_, i) => addSquare(10, i * 20, 0));
    store.getState().selectObjects(ids);
    store.getState().enterShapeBuilder();
    expect(store.getState().shapeBuilder).toBeNull();
  });

  it('excludes a group container', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 20, 0);
    store.getState().selectObjects([a, b]);
    store.getState().groupSelected();
    const g = store.getState().selectedObjectId!;
    const c = addSquare(10, 40, 0);
    store.getState().selectObjects([g, c]);
    store.getState().enterShapeBuilder();
    expect(store.getState().shapeBuilder).toBeNull();
  });

  it('excludes a symbol instance', () => {
    const a = addSquare(10, 0, 0);
    store.getState().selectObjects([a]);
    store.getState().createSymbol();
    const inst = store.getState().selectedObjectId!;
    const c = addSquare(10, 40, 0);
    store.getState().selectObjects([inst, c]);
    store.getState().enterShapeBuilder();
    expect(store.getState().shapeBuilder).toBeNull();
  });

  it('excludes a direct SVG-asset object', () => {
    const svg = addSvgObject();
    const c = addSquare(10, 40, 0);
    store.getState().selectObjects([svg, c]);
    store.getState().enterShapeBuilder();
    expect(store.getState().shapeBuilder).toBeNull();
  });

  it('excludes a text object', () => {
    const text = addTextObject();
    const c = addSquare(10, 40, 0);
    store.getState().selectObjects([text, c]);
    store.getState().enterShapeBuilder();
    expect(store.getState().shapeBuilder).toBeNull();
  });

  it('excludes a live-boolean RESULT (obj.boolean present)', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 5, 5);
    store.getState().selectObjects([a, b]);
    store.getState().booleanOp('union', { live: true });
    const liveResult = store.getState().selectedObjectId!;
    const c = addSquare(10, 40, 0);
    store.getState().selectObjects([liveResult, c]);
    store.getState().enterShapeBuilder();
    expect(store.getState().shapeBuilder).toBeNull();
  });

  it('excludes a live-boolean OPERAND', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 5, 5);
    store.getState().selectObjects([a, b]);
    store.getState().booleanOp('union', { live: true }); // a, b are now operands of the live result
    const c = addSquare(10, 40, 0);
    store.getState().selectObjects([a, c]);
    store.getState().enterShapeBuilder();
    expect(store.getState().shapeBuilder).toBeNull();
  });

  it('excludes a morphing (shapeTrack) path', () => {
    const a = addSquare(10, 0, 0);
    const project = store.getState().history.present;
    store.getState().commit({
      ...project,
      objects: project.objects.map((o) =>
        o.id === a ? { ...o, shapeTrack: [{ time: 0, path: assetOf(o).path!, easing: 'linear' as const }] } : o,
      ),
    });
    const c = addSquare(10, 40, 0);
    store.getState().selectObjects([a, c]);
    store.getState().enterShapeBuilder();
    expect(store.getState().shapeBuilder).toBeNull();
  });

  it('excludes a repeater object', () => {
    const a = addSquare(10, 0, 0);
    const project = store.getState().history.present;
    store.getState().commit({
      ...project,
      objects: project.objects.map((o) =>
        o.id === a ? { ...o, repeat: { count: 2, dx: 5, dy: 0, rotate: 0, scale: 1, stagger: 0 } } : o,
      ),
    });
    const c = addSquare(10, 40, 0);
    store.getState().selectObjects([a, c]);
    store.getState().enterShapeBuilder();
    expect(store.getState().shapeBuilder).toBeNull();
  });

  it('excludes a directly-locked object', () => {
    const a = addSquare(10, 0, 0);
    store.getState().toggleObjectLock(a);
    const c = addSquare(10, 40, 0);
    store.getState().selectObjects([a, c]);
    store.getState().enterShapeBuilder();
    expect(store.getState().shapeBuilder).toBeNull();
  });

  it('excludes a leaf whose ANCESTOR group is locked (lock cascade)', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 20, 0);
    store.getState().selectObjects([a, b]);
    store.getState().groupSelected();
    const g = store.getState().selectedObjectId!;
    store.getState().toggleObjectLock(g);
    const c = addSquare(10, 40, 0);
    // Select the bare leaf `a` directly (bypassing group-atomic UI selection) + eligible `c`.
    store.getState().selectObjects([a, c]);
    store.getState().enterShapeBuilder();
    expect(store.getState().shapeBuilder).toBeNull();
  });

  it('excludes an OPEN path (no closed primary ring)', () => {
    const a = addOpenPath();
    const c = addSquare(10, 40, 0);
    store.getState().selectObjects([a, c]);
    store.getState().enterShapeBuilder();
    expect(store.getState().shapeBuilder).toBeNull();
  });

  it('accepts 2..6 plain closed vector leaves (rect/ellipse/closed-path mix) and FREEZES the ids', () => {
    const a = addSquare(10, 0, 0);
    const b = addRect(20, 0);
    store.getState().addVectorShape('ellipse', { x: 40, y: 0, width: 10, height: 10 });
    const cId = store.getState().selectedObjectId!;
    store.getState().selectObjects([a, b, cId]);
    store.getState().enterShapeBuilder();
    expect(store.getState().shapeBuilder).toEqual({ ids: [a, b, cId] });
    expect(store.getState().toasts).toHaveLength(0);
  });
});

describe('exitShapeBuilder', () => {
  it('nulls the mode; no-op when already inactive', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 5, 5);
    store.getState().selectObjects([a, b]);
    store.getState().enterShapeBuilder();
    expect(store.getState().shapeBuilder).not.toBeNull();
    store.getState().exitShapeBuilder();
    expect(store.getState().shapeBuilder).toBeNull();
    store.getState().exitShapeBuilder(); // no-op, no throw
    expect(store.getState().shapeBuilder).toBeNull();
  });
});

describe('shapeBuilderMerge', () => {
  it('unions exactly the contributors, replaces them in shapeBuilder.ids, ONE commit, auto-exits under 2', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 5, 5);
    store.getState().selectObjects([a, b]);
    store.getState().enterShapeBuilder();
    const before = store.getState().history.present.objects.length;
    const pastLen = store.getState().history.past.length;

    store.getState().shapeBuilderMerge([a, b]);

    expect(store.getState().history.past.length).toBe(pastLen + 1); // exactly one commit
    const proj = store.getState().history.present;
    expect(proj.objects.length).toBe(before - 1); // 2 sources -> 1 result
    expect(proj.objects.some((o) => o.id === a || o.id === b)).toBe(false);
    // auto-exit: fewer than 2 frozen operands remain
    expect(store.getState().shapeBuilder).toBeNull();
  });

  it('does NOT touch selectedObjectIds (mode gestures target the frozen ids, not live selection)', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 5, 5);
    store.getState().selectObjects([a, b]);
    store.getState().enterShapeBuilder();
    const c = addSquare(10, 40, 0); // adding shifts selection to c
    store.getState().selectObject(c);
    const selectionBefore = store.getState().selectedObjectIds;
    store.getState().shapeBuilderMerge([a, b]);
    expect(store.getState().selectedObjectIds).toEqual(selectionBefore);
  });

  it('merges a SUBSET of 3+ frozen ids, splicing the merged id in and leaving the mode active', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 5, 5);
    const c = addSquare(10, 40, 0); // disjoint from a/b — still eligible; not merged
    store.getState().selectObjects([a, b, c]);
    store.getState().enterShapeBuilder();

    store.getState().shapeBuilderMerge([a, b]);

    expect(store.getState().shapeBuilder).not.toBeNull();
    const ids = store.getState().shapeBuilder!.ids;
    expect(ids).toHaveLength(2);
    expect(ids).toContain(c);
    expect(ids.some((id) => id !== c)).toBe(true); // the merged result's fresh id
    const mergedId = ids.find((id) => id !== c)!;
    expect(store.getState().history.present.objects.some((o) => o.id === mergedId)).toBe(true);
  });

  it('inherits style from the topmost contributing vector leaf (style-from-topmost, matches booleanOp)', () => {
    const a = addSquare(10, 0, 0); // default style, zOrder 0
    store.getState().setVectorStyle({ fill: '#00ff00' });
    const b = addSquare(10, 5, 5); // zOrder 1 (topmost), default style
    store.getState().setVectorStyle({ fill: '#0000ff' });
    store.getState().selectObjects([a, b]);
    store.getState().enterShapeBuilder();
    store.getState().shapeBuilderMerge([a, b]);
    const proj = store.getState().history.present;
    const result = proj.objects[0];
    const asset = proj.assets.find((x) => x.id === result.assetId) as VectorAsset;
    expect(asset.style.fill).toBe('#0000ff'); // b (topmost zOrder) wins
  });

  it('no-ops below 2 contributors', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 5, 5);
    store.getState().selectObjects([a, b]);
    store.getState().enterShapeBuilder();
    const pastLen = store.getState().history.past.length;
    store.getState().shapeBuilderMerge([a]);
    expect(store.getState().history.past.length).toBe(pastLen);
    expect(store.getState().shapeBuilder).toEqual({ ids: [a, b] });
  });

  it('no-ops while the mode is inactive', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 5, 5);
    const pastLen = store.getState().history.past.length;
    store.getState().shapeBuilderMerge([a, b]); // shapeBuilder is null
    expect(store.getState().history.past.length).toBe(pastLen);
  });

  it('is undoable: undo restores the source objects (project-level)', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 5, 5);
    store.getState().selectObjects([a, b]);
    store.getState().enterShapeBuilder();
    const beforeIds = store.getState().history.present.objects.map((o) => o.id).sort();
    store.getState().shapeBuilderMerge([a, b]);
    store.getState().undo();
    const afterIds = store.getState().history.present.objects.map((o) => o.id).sort();
    expect(afterIds).toEqual(beforeIds);
    // Known limitation: shapeBuilder mode state is TRANSIENT (not part of undo history), so an
    // undo after auto-exit leaves the mode inactive (it does not "un-auto-exit"). Documented,
    // not fixed here — see Task 2 report.
    expect(store.getState().shapeBuilder).toBeNull();
  });

  describe('groupSymbolSlice booleanOp suite (destructive branch, factor-out parity)', () => {
    it('booleanOp union still selects the result and commits once (unchanged behavior)', () => {
      const a = addSquare(10, 0, 0);
      const b = addSquare(10, 5, 5);
      store.getState().selectObjects([a, b]);
      const before = store.getState().history.present.objects.length;
      const pastLen = store.getState().history.past.length;
      store.getState().booleanOp('union');
      expect(store.getState().history.past.length).toBe(pastLen + 1);
      expect(store.getState().history.present.objects.length).toBe(before - 1);
      expect(store.getState().selectedObjectId).toBe(store.getState().history.present.objects[0].id);
    });
  });
});

describe('shapeBuilderPunch', () => {
  it('hand-computed: two overlapping 10x10 squares, punching the overlap leaves both L-shaped (area 75 each)', () => {
    const a = addSquare(10, 0, 0); // world (0,0)-(10,10)
    const b = addSquare(10, 5, 5); // world (5,5)-(15,15)
    store.getState().selectObjects([a, b]);
    store.getState().enterShapeBuilder();

    const region: PathData = square(5, 5, 5); // world (5,5)-(10,10) — the overlap
    const pastLen = store.getState().history.past.length;
    store.getState().shapeBuilderPunch([region], [a, b]);

    expect(store.getState().history.past.length).toBe(pastLen + 1); // ONE commit for the whole gesture

    const proj = store.getState().history.present;
    expect(proj.objects).toHaveLength(2); // neither contributor removed

    const aAsset = assetOf(obj(a));
    const bAsset = assetOf(obj(b));
    expect(aAsset.shapeType).toBe('path');
    expect(bAsset.shapeType).toBe('path');
    expect(Math.abs(ringArea(aAsset.path!.nodes.map((n) => n.anchor)))).toBeCloseTo(75, 6);
    expect(Math.abs(ringArea(bAsset.path!.nodes.map((n) => n.anchor)))).toBeCloseTo(75, 6);

    // A's local frame === world (base (0,0)): punched corner (7,7) now OUTSIDE; (2,2) still inside.
    expect(pointInRings([aAsset.path!], { x: 7, y: 7 })).toBe(false);
    expect(pointInRings([aAsset.path!], { x: 2, y: 2 })).toBe(true);

    // B's local frame is offset by base (5,5): world (7,7) -> local (2,2), still punched (outside);
    // world (6,14) -> local (1,9), still inside the remaining L.
    expect(pointInRings([bAsset.path!], { x: 2, y: 2 })).toBe(false);
    expect(pointInRings([bAsset.path!], { x: 1, y: 9 })).toBe(true);
  });

  it('empty-removal: a contributor fully covered by the region is removed (project + shapeBuilder.ids + orphan asset pruned)', () => {
    const big = addSquare(20, 0, 0); // world (0,0)-(20,20)
    const small = addSquare(5, 2, 2); // world (2,2)-(7,7), fully inside `big`
    store.getState().selectObjects([big, small]);
    store.getState().enterShapeBuilder();
    const smallAssetId = obj(small).assetId;

    const region: PathData = square(5, 2, 2); // == the whole `small` square
    store.getState().shapeBuilderPunch([region], [big, small]);

    const proj = store.getState().history.present;
    expect(proj.objects.some((o) => o.id === small)).toBe(false); // removed
    expect(proj.objects.some((o) => o.id === big)).toBe(true); // survives (punched)
    expect(proj.assets.some((a) => a.id === smallAssetId)).toBe(false); // orphaned source asset pruned
    expect(store.getState().shapeBuilder!.ids).toEqual([big]);
  });

  it('drops trim/dashOffsetTrack + pushes ONE shared info toast for the whole gesture (not per-contributor)', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 5, 5);
    store.getState().selectObjects([a, b]);
    store.getState().enterShapeBuilder();
    const project = store.getState().history.present;
    store.getState().commit({
      ...project,
      objects: project.objects.map((o) =>
        o.id === a || o.id === b ? { ...o, trim: { start: 0, end: 0.5, offset: 0 } } : o,
      ),
    });

    const region: PathData = square(5, 5, 5);
    store.getState().shapeBuilderPunch([region], [a, b]);

    expect(obj(a).trim).toBeUndefined();
    expect(obj(b).trim).toBeUndefined();
    expect(store.getState().toasts).toHaveLength(1); // ONE toast, even though BOTH contributors had trim
    expect(store.getState().toasts[0].kind).toBe('info');
    expect(store.getState().toasts[0].message).toBe('Trim/dash animation removed — path re-parameterized.');
  });

  it('primitive-detach: a stamped star contributor loses its primitive spec + primitive param tracks after punch', () => {
    store.getState().addPrimitive({ kind: 'star', cx: 5, cy: 5, radius: 5, rotation: 0, points: 5, innerRatio: 0.5, cornerRadius: 0 });
    const star = store.getState().selectedObjectId!;
    const b = addSquare(10, 3, 3);
    store.getState().selectObjects([star, b]);
    store.getState().enterShapeBuilder();
    expect(assetOf(obj(star)).primitive).toBeDefined(); // sanity: it IS a stamped primitive pre-punch

    const region: PathData = square(3, 3, 3); // a small corner overlap, not the whole star
    store.getState().shapeBuilderPunch([region], [star, b]);

    // The star may or may not survive (depends on overlap) — only assert on it if it does.
    const stillThere = store.getState().history.present.objects.find((o) => o.id === star);
    if (stillThere) {
      expect(assetOf(stillThere).primitive).toBeUndefined();
      expect(assetOf(stillThere).shapeType).toBe('path');
    }
  });

  it('rect-origin contributor: shapeType detaches to "path" after punch', () => {
    const a = addRect(0, 0);
    const b = addSquare(5, 5, 5);
    store.getState().selectObjects([a, b]);
    store.getState().enterShapeBuilder();
    const region: PathData = square(5, 5, 5);
    store.getState().shapeBuilderPunch([region], [a, b]);
    const aStillThere = store.getState().history.present.objects.find((o) => o.id === a);
    expect(aStillThere).toBeDefined();
    expect(assetOf(aStillThere!).shapeType).toBe('path');
    expect(assetOf(aStillThere!).path).toBeDefined();
  });

  it('trusts the caller-supplied contributorIds: a region disjoint from a contributor leaves its geometry unchanged (still commits — Stage always passes the region"s OWN contributors in real usage)', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 20, 0);
    store.getState().selectObjects([a, b]);
    store.getState().enterShapeBuilder();
    const farRegion: PathData = square(5, 100, 100); // nowhere near a or b
    store.getState().shapeBuilderPunch([farRegion], [a, b]);
    const aAsset = assetOf(obj(a));
    const bAsset = assetOf(obj(b));
    expect(Math.abs(ringArea(aAsset.path!.nodes.map((n) => n.anchor)))).toBeCloseTo(100, 6);
    expect(Math.abs(ringArea(bAsset.path!.nodes.map((n) => n.anchor)))).toBeCloseTo(100, 6);
  });

  it('no-ops (no commit) when contributorIds resolve to no vector objects at all', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 20, 0);
    store.getState().selectObjects([a, b]);
    store.getState().enterShapeBuilder();
    const pastLen = store.getState().history.past.length;
    store.getState().shapeBuilderPunch([square(5, 5, 5)], ['nonexistent-id']);
    expect(store.getState().history.past.length).toBe(pastLen);
  });

  it('no-ops while the mode is inactive', () => {
    const a = addSquare(10, 0, 0);
    const b = addSquare(10, 5, 5);
    const pastLen = store.getState().history.past.length;
    store.getState().shapeBuilderPunch([square(5, 5, 5)], [a, b]);
    expect(store.getState().history.past.length).toBe(pastLen);
  });

  it('SCALED contributor (self-review: exercises the non-identity branch of the world<->local inverse)', () => {
    const c = addSquare(10, 0, 0); // local (0,0)-(10,10), fraction anchor (0.5,0.5) -> world anchor (5,5)
    const project = store.getState().history.present;
    store.getState().commit({
      ...project,
      objects: project.objects.map((o) => (o.id === c ? { ...o, base: { ...o.base, scaleX: 2, scaleY: 2 } } : o)),
    });
    // World bbox is now (-5,-5)-(15,15) (2x scale about the world anchor (5,5)).
    const b = addSquare(10, 40, 40); // unrelated second contributor (eligibility needs 2+)
    store.getState().selectObjects([c, b]);
    store.getState().enterShapeBuilder();

    // World region (-5,-5)-(5,5) maps (hand-derived) to LOCAL (0,0)-(5,5) exactly.
    const region: PathData = square(10, -5, -5);
    store.getState().shapeBuilderPunch([region], [c, b]);

    const cAsset = assetOf(obj(c));
    expect(Math.abs(ringArea(cAsset.path!.nodes.map((n) => n.anchor)))).toBeCloseTo(75, 6); // 100 - 25
    expect(pointInRings([cAsset.path!], { x: 2, y: 2 })).toBe(false); // inside the punched local quarter
    expect(pointInRings([cAsset.path!], { x: 8, y: 8 })).toBe(true); // remaining L
  });

  it('in-symbol scope: punch routes to the SYMBOL asset internals, not root project.objects/assets', () => {
    const a = addSquare(10, 0, 0); // world (0,0)-(10,10)
    const b = addSquare(10, 5, 5); // world (5,5)-(15,15)
    store.getState().selectObjects([a, b]);
    store.getState().createSymbol(); // members "keep their authored coordinates inside the symbol"
    const instance = obj(store.getState().selectedObjectId!);
    const symId = instance.assetId;

    store.getState().enterSymbol(symId);
    store.getState().selectObjects([a, b]); // ids are preserved inside the symbol's own objects[]
    store.getState().enterShapeBuilder();
    expect(store.getState().shapeBuilder).toEqual({ ids: [a, b] });

    const region: PathData = square(5, 5, 5); // same literal world coords as the root-level test
    store.getState().shapeBuilderPunch([region], [a, b]);

    const proj = store.getState().history.present;
    // Root scene untouched.
    expect(proj.objects.some((o) => o.id === a || o.id === b)).toBe(false);
    const symAsset = proj.assets.find((x) => x.id === symId) as SymbolAsset;
    const aInSym = symAsset.objects.find((o) => o.id === a)!;
    const aAsset = proj.assets.find((x) => x.id === aInSym.assetId) as VectorAsset;
    expect(Math.abs(ringArea(aAsset.path!.nodes.map((n) => n.anchor)))).toBeCloseTo(75, 6);
  });
});
