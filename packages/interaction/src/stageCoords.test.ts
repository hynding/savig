import { makeStageCoordinates } from './stageCoords';

type Ctm = { a: number; b: number; c: number; d: number; e: number; f: number };
const groupWith = (ctm: Ctm | null) => ({ getScreenCTM: () => ctm }) as unknown as SVGGElement;

describe('makeStageCoordinates.clientScale', () => {
  it('reads the content CTM scale (viewBox fit times zoom)', () => {
    const c = makeStageCoordinates({ current: groupWith({ a: 0.75, b: 0, c: 0, d: 0.75, e: 10, f: 20 }) }, { current: null });
    expect(c.clientScale()).toBeCloseTo(0.75);
  });

  it('is rotation-invariant (uses the column length)', () => {
    const k = 1.5;
    const t = Math.PI / 6;
    const c = makeStageCoordinates(
      { current: groupWith({ a: k * Math.cos(t), b: k * Math.sin(t), c: -k * Math.sin(t), d: k * Math.cos(t), e: 0, f: 0 }) },
      { current: null },
    );
    expect(c.clientScale()).toBeCloseTo(k);
  });

  it('is null without a group or CTM, or for a degenerate scale', () => {
    expect(makeStageCoordinates({ current: null }, { current: null }).clientScale()).toBeNull();
    expect(makeStageCoordinates({ current: groupWith(null) }, { current: null }).clientScale()).toBeNull();
    expect(makeStageCoordinates({ current: groupWith({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }) }, { current: null }).clientScale()).toBeNull();
  });
});
