import { describe, it, expect } from 'vitest';
import { cutPath, segmentCubic } from './cutPath';
import { evalCubic, type Cubic } from './geom/boolean-curves';
import { flattenPath } from './geom/arcLength';
import type { PathData } from './types';

// ---------------------------------------------------------------------------------------
// Hand-computed de Casteljau reference (brief Step 1): cubic p0=(0,0) c1=(10,0) c2=(20,10)
// p3=(30,10), split at t=0.5.
//
//   ab  = lerp(p0,c1,.5)  = (5, 0)
//   bc  = lerp(c1,c2,.5)  = (15, 5)
//   cd  = lerp(c2,p3,.5)  = (25, 10)
//   abc = lerp(ab,bc,.5)  = (10, 2.5)
//   bcd = lerp(bc,cd,.5)  = (20, 7.5)
//   p   = lerp(abc,bcd,.5)= (15, 5)
//
//   LEFT  [0,.5]: p0=(0,0)   c1=ab=(5,0)    c2=abc=(10,2.5) p3=p=(15,5)
//   RIGHT [.5,1]: p0=p=(15,5) c1=bcd=(20,7.5) c2=cd=(25,10)  p3=p3=(30,10)
// ---------------------------------------------------------------------------------------
const HAND_CUBIC: Cubic = {
  p0: { x: 0, y: 0 },
  c1: { x: 10, y: 0 },
  c2: { x: 20, y: 10 },
  p3: { x: 30, y: 10 },
};
const HAND_LEFT: Cubic = {
  p0: { x: 0, y: 0 },
  c1: { x: 5, y: 0 },
  c2: { x: 10, y: 2.5 },
  p3: { x: 15, y: 5 },
};
const HAND_RIGHT: Cubic = {
  p0: { x: 15, y: 5 },
  c1: { x: 20, y: 7.5 },
  c2: { x: 25, y: 10 },
  p3: { x: 30, y: 10 },
};

describe('cutPath', () => {
  it('1. open 3-node straight path, cut mid segment 0 -> split with no handles on cut anchors', () => {
    const path: PathData = {
      closed: false,
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 20, y: 0 } }],
    };
    const result = cutPath(path, 0, 0.5);
    expect(result.kind).toBe('split');
    if (result.kind !== 'split') throw new Error('expected split');
    expect(result.a).toEqual<PathData>({
      closed: false,
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 5, y: 0 } }],
    });
    expect(result.b).toEqual<PathData>({
      closed: false,
      nodes: [{ anchor: { x: 5, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 20, y: 0 } }],
    });
  });

  it('2. open path with a curved middle segment, cut at t=0.5 -> hand-computed de Casteljau handles', () => {
    // n0 (straight) -- n1=p0 --(curve)-- n2=p3 -- n3 (straight)
    const path: PathData = {
      closed: false,
      nodes: [
        { anchor: { x: -10, y: 0 } },
        { anchor: HAND_CUBIC.p0, out: { x: HAND_CUBIC.c1.x - HAND_CUBIC.p0.x, y: HAND_CUBIC.c1.y - HAND_CUBIC.p0.y } },
        { anchor: HAND_CUBIC.p3, in: { x: HAND_CUBIC.c2.x - HAND_CUBIC.p3.x, y: HAND_CUBIC.c2.y - HAND_CUBIC.p3.y } },
        { anchor: { x: 40, y: 10 } },
      ],
    };
    const result = cutPath(path, 1, 0.5);
    expect(result.kind).toBe('split');
    if (result.kind !== 'split') throw new Error('expected split');

    // Piece a: [n0, n1'(out=HAND_LEFT.c1-p0), cut(in=HAND_LEFT.c2-p)]
    expect(result.a.nodes).toEqual([
      { anchor: { x: -10, y: 0 } },
      { anchor: { x: 0, y: 0 }, out: { x: 5, y: 0 } },
      { anchor: { x: 15, y: 5 }, in: { x: -5, y: -2.5 } },
    ]);
    // Piece b: [cut(out=HAND_RIGHT.c1-p), n2'(in=HAND_RIGHT.c2-p3), n3]
    expect(result.b.nodes).toEqual([
      { anchor: { x: 15, y: 5 }, out: { x: 5, y: 2.5 } },
      { anchor: { x: 30, y: 10 }, in: { x: -5, y: 0 } },
      { anchor: { x: 40, y: 10 } },
    ]);

    // The reconstructed cubics are algebraically exact de Casteljau halves.
    const leftCubic = segmentCubic(result.a, 1);
    const rightCubic = segmentCubic(result.b, 0);
    expect(leftCubic).toEqual(HAND_LEFT);
    expect(rightCubic).toEqual(HAND_RIGHT);

    // Geometry preservation: sampling the ORIGINAL cubic at t must equal sampling the
    // correct half (remapped into its own [0,1]) at every one of 32 points — an exact
    // algebraic identity of de Casteljau subdivision, independent of any flattening
    // approximation (FLATTEN_STEPS=16 chord error is ~1e-2, far looser than the 1e-6
    // the brief asks for — see cutPath.test.ts's second, flattenPath-based check below
    // for the coarse sanity net the brief's "flattenPath both" wording literally names).
    const N = 32;
    let maxDev = 0;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const expected = evalCubic(HAND_CUBIC, t);
      const actual = t <= 0.5 ? evalCubic(leftCubic!, t / 0.5) : evalCubic(rightCubic!, (t - 0.5) / 0.5);
      maxDev = Math.max(maxDev, Math.hypot(actual.x - expected.x, actual.y - expected.y));
    }
    expect(maxDev).toBeLessThan(1e-9);

    // Coarse flattenPath-based sanity net (brief: "flattenPath both, sample N=32 points"):
    // flatten the ORIGINAL path and a RECONSTRUCTED merged path (a's nodes + b's nodes,
    // deduped at the shared cut node) — both describe the identical curve, just with an
    // extra node splitting the middle segment in two, so both flattenings sample the SAME
    // underlying math (flattenPoints: straight segments push only their end anchor;
    // curved segments push FLATTEN_STEPS=16 subdivided points — see arcLength.ts). The
    // original's 19 points are [n0, n1, curve(t=1/16..16/16), n3]; the merged
    // reconstruction's 35 points are [n0, n1', curveA(t=1/32..16/32), curveB(t=17/32..32/32),
    // n3] — every original curve sample at t=k/16 reappears in the merged flatten at
    // t=2k/32, i.e. merged index 2*origIndex-1 for the 18 non-start original points.
    const aCut = result.a.nodes[result.a.nodes.length - 1];
    const bCut = result.b.nodes[0];
    const mergedCut = {
      anchor: aCut.anchor,
      ...(aCut.in ? { in: aCut.in } : {}),
      ...(bCut.out ? { out: bCut.out } : {}),
    };
    const merged: PathData = {
      closed: false,
      nodes: [...result.a.nodes.slice(0, -1), mergedCut, ...result.b.nodes.slice(1)],
    };
    const origFlat = flattenPath(path);
    const mergedFlat = flattenPath(merged);
    expect(origFlat.pts.length).toBe(19); // start + straight(1) + curve(16) + straight(1)
    expect(mergedFlat.pts.length).toBe(35); // start + straight(1) + curveA(16) + curveB(16) + straight(1)
    let flattenMaxDev = 0;
    for (let i = 0; i < origFlat.pts.length; i++) {
      const j = i === 0 ? 0 : i === origFlat.pts.length - 1 ? mergedFlat.pts.length - 1 : 2 * i - 1;
      const p = origFlat.pts[i];
      const q = mergedFlat.pts[j];
      flattenMaxDev = Math.max(flattenMaxDev, Math.hypot(p.x - q.x, p.y - q.y));
    }
    expect(flattenMaxDev).toBeLessThan(1e-6);
  });

  it('3. closed square, cut segment 2 at t=0.25 -> opened, winding-ordered, node count +2', () => {
    const path: PathData = {
      closed: true,
      nodes: [
        { anchor: { x: 0, y: 0 } }, // n0
        { anchor: { x: 10, y: 0 } }, // n1
        { anchor: { x: 10, y: 10 } }, // n2
        { anchor: { x: 0, y: 10 } }, // n3
      ],
    };
    // segment 2 = n2 -> n3 (straight); t=0.25 -> cut = lerp((10,10),(0,10),.25) = (7.5,10)
    const result = cutPath(path, 2, 0.25);
    expect(result.kind).toBe('opened');
    if (result.kind !== 'opened') throw new Error('expected opened');
    expect(result.path.closed).toBe(false);
    expect(result.path.nodes).toEqual([
      { anchor: { x: 7.5, y: 10 } }, // cut (start, out toward n3)
      { anchor: { x: 0, y: 10 } }, // n3
      { anchor: { x: 0, y: 0 } }, // n0
      { anchor: { x: 10, y: 0 } }, // n1
      { anchor: { x: 10, y: 10 } }, // n2 (segment endpoint, subdivided out — straight, none)
      { anchor: { x: 7.5, y: 10 } }, // cut (end, in from n2)
    ]);
    expect(result.path.nodes.length).toBe(path.nodes.length + 2);
  });

  it('4. degenerate: t=0 on segment 0 and t=1 on the last segment of an open path -> noop', () => {
    const path: PathData = {
      closed: false,
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 20, y: 0 } }],
    };
    expect(cutPath(path, 0, 0)).toEqual({ kind: 'noop' });
    expect(cutPath(path, 1, 1)).toEqual({ kind: 'noop' });
    // Interior t on the same boundary segments is NOT degenerate.
    expect(cutPath(path, 0, 0.5).kind).toBe('split');
    expect(cutPath(path, 1, 0.5).kind).toBe('split');
  });

  it('5. segmentCubic: correct cubic for a handled segment, null for a bare (straight) one', () => {
    const path: PathData = {
      closed: false,
      nodes: [
        { anchor: { x: -10, y: 0 } },
        { anchor: HAND_CUBIC.p0, out: { x: HAND_CUBIC.c1.x - HAND_CUBIC.p0.x, y: HAND_CUBIC.c1.y - HAND_CUBIC.p0.y } },
        { anchor: HAND_CUBIC.p3, in: { x: HAND_CUBIC.c2.x - HAND_CUBIC.p3.x, y: HAND_CUBIC.c2.y - HAND_CUBIC.p3.y } },
        { anchor: { x: 40, y: 10 } },
      ],
    };
    expect(segmentCubic(path, 1)).toEqual(HAND_CUBIC);
    expect(segmentCubic(path, 0)).toBeNull(); // straight segment 0 (n0-n1)
    expect(segmentCubic(path, 2)).toBeNull(); // straight segment 2 (n2-n3)
    expect(segmentCubic(path, 99)).toBeNull(); // out of range
  });
});
