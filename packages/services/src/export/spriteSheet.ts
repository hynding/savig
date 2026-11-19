// Sprite-sheet export (roadmap 11): the pure half — frame plan, grid layout, and the atlas JSON.
// Rasterizing is platform-specific (browser canvas in the editor, resvg in @savig/core/node); both
// lay frames out with `spriteSheetLayout` and describe them with `spriteSheetAtlas`, so the editor
// and MCP produce identical sheets for the same options.
//
// The atlas is TexturePacker's "JSON (Hash)" shape, which Phaser, PixiJS and most engines load
// directly, plus Pixi's `animations` list and Aseprite-style `meta.frameTags` naming the clip.
import { strToU8, zipSync } from 'fflate';
import { computeProjectDuration } from '@savig/engine';
import type { Project } from '@savig/engine';

/** Largest sheet side we produce: browsers cap canvases near 16k and many GPUs cap textures at 8k. */
export const SPRITE_SHEET_MAX_SIDE = 8192;
export const SPRITE_SHEET_MAX_FPS = 60;
/** Hard cap on frames in one sheet (a 10s clip at 60 fps). */
export const SPRITE_SHEET_MAX_FRAMES = 600;

export interface SpriteSheetOptions {
  /** Frames per second sampled from the animation (whole number, 1..60). */
  fps: number;
  /** Width of one frame cell in px; height follows the artboard aspect. */
  frameWidth: number;
  /** Cells per row; omitted/0 = as square a sheet as possible. */
  columns?: number;
  /** Gap between cells in px (default 0). */
  padding?: number;
}

export interface SpriteSheetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpriteSheetPlan {
  fps: number;
  frameCount: number;
  /** Sample time (seconds) of each frame. */
  times: number[];
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  padding: number;
  width: number;
  height: number;
  /** Cell rect per frame, row-major. */
  cells: SpriteSheetRect[];
}

const whole = (v: number | undefined, fallback: number) => (v !== undefined && Number.isFinite(v) ? Math.round(v) : fallback);

/** Plan a sheet: clamp the options, pick the frame times (i / fps across the project duration,
 *  one frame for a static project), and lay the cells out row-major. Throws when the sheet
 *  would exceed SPRITE_SHEET_MAX_SIDE so callers can tell the user before rendering anything. */
export function planSpriteSheet(project: Project, opts: SpriteSheetOptions): SpriteSheetPlan {
  const fps = Math.max(1, Math.min(SPRITE_SHEET_MAX_FPS, whole(opts.fps, project.meta.fps)));
  const frameWidth = Math.max(1, whole(opts.frameWidth, project.meta.width)); // oversize is reported below, not clamped
  const frameHeight = Math.max(1, Math.round((frameWidth * project.meta.height) / project.meta.width));
  const padding = Math.max(0, whole(opts.padding, 0));
  const duration = computeProjectDuration(project);
  const total = duration > 0 ? Math.max(1, Math.round(duration * fps)) : 1;
  if (total > SPRITE_SHEET_MAX_FRAMES) {
    throw new Error(`A sprite sheet holds at most ${SPRITE_SHEET_MAX_FRAMES} frames (${total} requested): lower the fps or shorten the project.`);
  }
  const times = Array.from({ length: total }, (_, i) => i / fps);
  const requested = whole(opts.columns, 0);
  const columns = requested > 0 ? Math.min(requested, total) : Math.ceil(Math.sqrt(total));
  const rows = Math.ceil(total / columns);
  const width = columns * frameWidth + (columns - 1) * padding;
  const height = rows * frameHeight + (rows - 1) * padding;
  if (width > SPRITE_SHEET_MAX_SIDE || height > SPRITE_SHEET_MAX_SIDE) {
    throw new Error(
      `The sheet would be ${width}×${height}px, over the ${SPRITE_SHEET_MAX_SIDE}px limit: lower the frame width, the fps, or change the columns.`,
    );
  }
  const cells = times.map((_, i) => ({
    x: (i % columns) * (frameWidth + padding),
    y: Math.floor(i / columns) * (frameHeight + padding),
    w: frameWidth,
    h: frameHeight,
  }));
  return { fps, frameCount: total, times, frameWidth, frameHeight, columns, rows, padding, width, height, cells };
}

/** A file-name-safe stem for the sheet and its frames. */
export function spriteSheetStem(name: string): string {
  const stem = name.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
  return stem || 'sprites';
}

export interface SpriteSheetAtlas {
  frames: Record<string, {
    frame: SpriteSheetRect;
    rotated: false;
    trimmed: false;
    spriteSourceSize: SpriteSheetRect;
    sourceSize: { w: number; h: number };
    /** Display time in ms (Aseprite convention). */
    duration: number;
  }>;
  animations: Record<string, string[]>;
  meta: {
    app: string;
    version: string;
    image: string;
    format: 'RGBA8888';
    size: { w: number; h: number };
    scale: '1';
    fps: number;
    frameTags: { name: string; from: number; to: number; direction: 'forward' }[];
  };
}

/** The atlas JSON describing `plan`'s cells; frames are named `<stem>_0000`, `<stem>_0001`… */
export function spriteSheetAtlas(plan: SpriteSheetPlan, name: string, image = `${spriteSheetStem(name)}.png`): SpriteSheetAtlas {
  const stem = spriteSheetStem(name);
  const pad = Math.max(4, String(plan.frameCount - 1).length);
  const names = plan.cells.map((_, i) => `${stem}_${String(i).padStart(pad, '0')}`);
  const frames: SpriteSheetAtlas['frames'] = {};
  plan.cells.forEach((cell, i) => {
    frames[names[i]] = {
      frame: { ...cell },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: cell.w, h: cell.h },
      sourceSize: { w: cell.w, h: cell.h },
      duration: Math.round(1000 / plan.fps),
    };
  });
  return {
    frames,
    animations: { [stem]: names },
    meta: {
      app: 'SaViG',
      version: '1',
      image,
      format: 'RGBA8888',
      size: { w: plan.width, h: plan.height },
      scale: '1',
      fps: plan.fps,
      frameTags: [{ name: stem, from: 0, to: plan.frameCount - 1, direction: 'forward' }],
    },
  };
}

/** Bundle the sheet PNG and its atlas JSON as `<stem>.png` + `<stem>.json` in one zip. */
export function zipSpriteSheet(png: Uint8Array, atlas: SpriteSheetAtlas, name: string): Uint8Array {
  const stem = spriteSheetStem(name);
  return zipSync({ [`${stem}.png`]: png, [`${stem}.json`]: strToU8(JSON.stringify(atlas, null, 2)) });
}
