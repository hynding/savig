/** Sprite-sheet rendering for agents / MCP (roadmap 11). Uses the same plan + atlas as the editor
 *  (`@savig/services` export/spriteSheet), so both produce identical sheets for the same options.
 *
 *  Each frame is rasterized on its own by resvg (`renderFrameRgba` — faithful by construction) and
 *  blitted into one RGBA buffer, then PNG-encoded here. Frames are NOT stitched as one SVG: the
 *  export's def ids (gradients, clipPaths, symbols) would collide across cells (see renderFrames). */
import { deflateSync } from 'node:zlib';
import type { Project } from '@savig/engine';
import { planSpriteSheet, spriteSheetAtlas, zipSpriteSheet, type SpriteSheetAtlas, type SpriteSheetOptions, type SpriteSheetPlan } from '@savig/services';
import { renderFrameRgba } from './render';

export interface SpriteSheetRenderOpts extends SpriteSheetOptions {
  /** Paint behind each cell; default 'transparent' (alpha PNG, the usual choice for sprites). */
  background?: string;
}

export interface SpriteSheetRender {
  png: Uint8Array;
  atlas: SpriteSheetAtlas;
  plan: SpriteSheetPlan;
  /** `<name>.png` + `<name>.json` zipped, ready to save. */
  zip(): Uint8Array;
}

/** Render the project as one sprite-sheet PNG plus its atlas JSON. Throws (before rendering) when
 *  the sheet would be too large or hold too many frames. */
export function renderSpriteSheet(project: Project, opts: SpriteSheetRenderOpts): SpriteSheetRender {
  const plan = planSpriteSheet(project, opts);
  const sheet = new Uint8Array(plan.width * plan.height * 4);
  const background = opts.background ?? 'transparent';
  plan.cells.forEach((cell, i) => {
    const frame = renderFrameRgba(project, plan.times[i], { width: cell.w, background });
    // resvg fits to the width; the height can differ from the plan's by a rounding pixel.
    const rows = Math.min(cell.h, frame.height);
    const cols = Math.min(cell.w, frame.width);
    for (let y = 0; y < rows; y++) {
      const src = y * frame.width * 4;
      sheet.set(frame.pixels.subarray(src, src + cols * 4), ((cell.y + y) * plan.width + cell.x) * 4);
    }
  });
  const png = encodePng(plan.width, plan.height, sheet);
  const atlas = spriteSheetAtlas(plan, project.meta.name);
  return { png, atlas, plan, zip: () => zipSpriteSheet(png, atlas, project.meta.name) };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encode straight (non-premultiplied) RGBA8 pixels as a PNG (filter 0 per row, zlib deflate). */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
