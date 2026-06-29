import { describe, it, expect } from 'vitest';
import { createProject } from '../engine';
import { addRect, setKeyframe } from './build';
import { renderFrameSvg, renderFramePng, renderThumbnail, renderFrames } from './render';

const PNG_MAGIC = [137, 80, 78, 71];

const bytesEqual = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

function withFade() {
  // a rect whose opacity animates 1 -> 0 over [0, 1]s
  let p = addRect(createProject({ width: 200, height: 100 }), { x: 50, y: 25, width: 40, height: 40, id: 'r', style: { fill: '#3366ff' } }).project;
  p = setKeyframe(p, { objectId: 'r', property: 'opacity', time: 0, value: 1 });
  p = setKeyframe(p, { objectId: 'r', property: 'opacity', time: 1, value: 0 });
  return p;
}

describe('core/render renderFrameSvg', () => {
  it('produces a static <svg> with the runtime script stripped', () => {
    const svg = renderFrameSvg(withFade(), 0);
    expect(svg).toMatch(/^<svg/);
    expect(svg).not.toContain('<script');
  });

  it('bakes the frame — opacity differs between t=0 and t=1', () => {
    const p = withFade();
    const at0 = renderFrameSvg(p, 0);
    const at1 = renderFrameSvg(p, 1);
    expect(at0).not.toEqual(at1);
    // at the end of the fade the object's opacity is ~0
    expect(at1).toMatch(/opacity="0(\.0+)?"/);
  });
});

describe('core/render renderFramePng', () => {
  it('rasterizes a frame to a PNG', () => {
    const png = renderFramePng(withFade(), 0, { width: 100 });
    expect([...png.slice(0, 4)]).toEqual(PNG_MAGIC);
    expect(png.length).toBeGreaterThan(100);
  });

  it('renders different bytes at different times (the fade is visible)', () => {
    const p = withFade();
    const a = renderFramePng(p, 0, { width: 100 });
    const b = renderFramePng(p, 1, { width: 100 });
    expect(bytesEqual(a, b)).toBe(false);
  });
});

describe('core/render renderThumbnail / renderFrames', () => {
  it('renderThumbnail returns a PNG', () => {
    const png = renderThumbnail(withFade());
    expect([...png.slice(0, 4)]).toEqual(PNG_MAGIC);
  });

  it('renderFrames returns N PNGs spanning [0, duration]', () => {
    const frames = renderFrames(withFade(), { count: 5, width: 80 });
    expect(frames).toHaveLength(5);
    expect(frames[0].time).toBe(0);
    expect(frames[4].time).toBeCloseTo(1, 5); // duration is 1s (opacity track ends at 1)
    for (const f of frames) expect([...f.png.slice(0, 4)]).toEqual(PNG_MAGIC);
  });
});
