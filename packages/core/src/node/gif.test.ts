import { describe, it, expect } from 'vitest';
import { createProject } from '@savig/engine';
import { addRect, setKeyframe } from '../build';
import { renderGif } from './gif';

const GIF_MAGIC = [71, 73, 70, 56, 57, 97]; // "GIF89a"

function slide() {
  let p = addRect(createProject({ width: 120, height: 60 }), { x: 0, y: 20, width: 20, height: 20, id: 'r', style: { fill: '#09f' } }).project;
  p = setKeyframe(p, { objectId: 'r', property: 'x', time: 0, value: 0 });
  p = setKeyframe(p, { objectId: 'r', property: 'x', time: 1, value: 80 });
  return p;
}

describe('core/gif renderGif', () => {
  it('encodes a looping animated GIF (GIF89a)', () => {
    const gif = renderGif(slide(), { fps: 8, width: 80 });
    expect([...gif.slice(0, 6)]).toEqual(GIF_MAGIC);
    expect(gif.length).toBeGreaterThan(100);
  });

  it('honors the frame cap', () => {
    const small = renderGif(slide(), { fps: 8, width: 40, maxFrames: 2 });
    const big = renderGif(slide(), { fps: 8, width: 40 });
    expect(small.length).toBeLessThan(big.length); // fewer frames -> smaller file
  });

  it('handles a still (zero-duration) project as a single-frame GIF', () => {
    const still = addRect(createProject({ width: 40, height: 40 }), { x: 0, y: 0, width: 20, height: 20, id: 'r' }).project;
    const gif = renderGif(still, { fps: 10 });
    expect([...gif.slice(0, 6)]).toEqual(GIF_MAGIC);
  });
});
