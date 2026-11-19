import { describe, it, expect } from 'vitest';
import { inflateSync } from 'node:zlib';
import { strFromU8, unzipSync } from 'fflate';
import { createProject } from '@savig/engine';
import { addRect, setKeyframe } from '../build';
import { encodePng, renderSpriteSheet } from './spriteSheet';

/** 120x60 artboard; a blue 20px square slides x 0 -> 80 over 1s. */
function slide() {
  let p = addRect(createProject({ width: 120, height: 60 }), { x: 0, y: 20, width: 20, height: 20, id: 'r', style: { fill: '#0000ff' } }).project;
  p = setKeyframe(p, { objectId: 'r', property: 'x', time: 0, value: 0 });
  p = setKeyframe(p, { objectId: 'r', property: 'x', time: 1, value: 80 });
  return p;
}

/** Minimal PNG reader for our own encoder's output (8-bit RGBA, filter 0 rows). */
function decode(png: Uint8Array) {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = v.getUint32(16);
  const height = v.getUint32(20);
  const idat: Uint8Array[] = [];
  for (let o = 8; o < png.length; ) {
    const len = v.getUint32(o);
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    if (type === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = (x: number, y: number) => {
    const i = y * (width * 4 + 1) + 1 + x * 4;
    return [raw[i], raw[i + 1], raw[i + 2], raw[i + 3]];
  };
  return { width, height, px };
}

describe('core/spriteSheet', () => {
  it('encodePng round-trips exact pixels', () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 1, 2, 3, 4]);
    const d = decode(encodePng(2, 2, rgba));
    expect([d.width, d.height]).toEqual([2, 2]);
    expect(d.px(0, 0)).toEqual([255, 0, 0, 255]);
    expect(d.px(1, 0)).toEqual([0, 255, 0, 128]);
    expect(d.px(1, 1)).toEqual([1, 2, 3, 4]);
  });

  it('lays frames into cells with a matching atlas; the square moves right across cells', () => {
    const sheet = renderSpriteSheet(slide(), { fps: 4, frameWidth: 60, columns: 2, padding: 2 });
    expect(sheet.plan.frameCount).toBe(4);
    const d = decode(sheet.png);
    expect([d.width, d.height]).toEqual([2 * 60 + 2, 2 * 30 + 2]);
    expect(sheet.atlas.meta.size).toEqual({ w: d.width, h: d.height });
    const cells = Object.values(sheet.atlas.frames).map((f) => f.frame);
    expect(cells[3]).toEqual({ x: 62, y: 32, w: 60, h: 30 });
    // Frame 0: square at x 0..10 (half scale) — blue at cell (2, 15); frame 3 (t=0.75 -> x=60 -> 30..40).
    expect(d.px(cells[0].x + 2, cells[0].y + 15).slice(0, 3)).toEqual([0, 0, 255]);
    expect(d.px(cells[3].x + 2, cells[3].y + 15)[3]).toBe(0); // transparent where the square left
    expect(d.px(cells[3].x + 35, cells[3].y + 15).slice(0, 3)).toEqual([0, 0, 255]);
    // Padding stays transparent.
    expect(d.px(60, 5)[3]).toBe(0);
  });

  it('an opaque background fills the cells', () => {
    const d = decode(renderSpriteSheet(slide(), { fps: 1, frameWidth: 40, background: 'white' }).png);
    expect(d.px(39, 0)).toEqual([255, 255, 255, 255]);
  });

  it('zips <name>.png + <name>.json', () => {
    const files = unzipSync(renderSpriteSheet(slide(), { fps: 2, frameWidth: 20 }).zip());
    const names = Object.keys(files).sort();
    expect(names).toHaveLength(2);
    expect(names[0].endsWith('.json') && names[1].endsWith('.png')).toBe(true);
    expect(JSON.parse(strFromU8(files[names[0]])).meta.image).toBe(names[1]);
  });

  it('refuses an oversize sheet before rendering', () => {
    expect(() => renderSpriteSheet(slide(), { fps: 60, frameWidth: 2000 })).toThrow(/limit/);
  });
});
