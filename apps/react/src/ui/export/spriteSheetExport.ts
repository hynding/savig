// Browser sprite-sheet export (roadmap 11): frames from the shared frame source (applyProjectFrame
// over a detached document, as video/GIF export), drawn into one canvas cell by cell, saved as a
// zip of `<name>.png` + `<name>.json` (TexturePacker JSON-hash atlas, see services/spriteSheet).
// Works on a project SNAPSHOT; cancel resolves null (nothing saved).
import type { Project } from '@savig/engine';
import { planSpriteSheet, spriteSheetAtlas, spriteSheetStem, zipSpriteSheet, type SpriteSheetOptions, type SpriteSheetPlan, type SpriteSheetRect } from '@savig/services';
import { createFrameSource, type FrameSource } from './frameSource';

export interface SpriteSheetExportOptions extends SpriteSheetOptions {
  /** Cell background; null leaves the sheet transparent (the usual choice for game sprites). */
  background: string | null;
}

export interface SpriteSheetExportResult {
  bytes: Uint8Array;
  filename: string;
  mime: 'application/zip';
  plan: SpriteSheetPlan;
}

/** One sheet being painted: draw frames into cells, then encode the PNG. */
export interface SheetCanvas {
  draw(svg: string, cell: SpriteSheetRect): Promise<void>;
  toPng(): Promise<Uint8Array>;
}

export interface SpriteSheetExportDeps {
  makeFrameSource: (project: Project) => FrameSource;
  makeSheet: (width: number, height: number, background: string | null) => SheetCanvas;
}

const DEFAULT_DEPS: SpriteSheetExportDeps = {
  makeFrameSource: createFrameSource,
  makeSheet: createCanvasSheet,
};

export async function exportSpriteSheet(
  project: Project,
  opts: SpriteSheetExportOptions,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
  deps: Partial<SpriteSheetExportDeps> = {},
): Promise<SpriteSheetExportResult | null> {
  const d = { ...DEFAULT_DEPS, ...deps };
  const plan = planSpriteSheet(project, opts); // throws on an oversize sheet before any work
  const src = d.makeFrameSource(project);
  const sheet = d.makeSheet(plan.width, plan.height, opts.background);
  onProgress(0);
  for (let i = 0; i < plan.frameCount; i++) {
    if (signal.aborted) return null;
    await sheet.draw(src.frameSvg(plan.times[i]), plan.cells[i]);
    onProgress(((i + 1) / plan.frameCount) * 0.95);
  }
  if (signal.aborted) return null;
  const png = await sheet.toPng();
  if (signal.aborted) return null;
  const atlas = spriteSheetAtlas(plan, project.meta.name);
  onProgress(1);
  return {
    bytes: zipSpriteSheet(png, atlas, project.meta.name),
    filename: `${spriteSheetStem(project.meta.name)}-spritesheet.zip`,
    mime: 'application/zip',
    plan,
  };
}

/** Browser-only (canvas + <img>; covered by the e2e — jsdom has neither). */
export function createCanvasSheet(width: number, height: number, background: string | null): SheetCanvas {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  return {
    draw(svg, cell) {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      return new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          try {
            ctx.drawImage(img, cell.x, cell.y, cell.w, cell.h);
            resolve();
          } catch (err) {
            reject(err as Error);
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('frame SVG failed to decode'));
        };
        img.src = url;
      });
    },
    toPng() {
      return new Promise<Uint8Array>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) return reject(new Error('canvas.toBlob returned null'));
          const reader = new FileReader();
          reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
          reader.onerror = () => reject(reader.error ?? new Error('Could not read the sheet PNG'));
          reader.readAsArrayBuffer(blob);
        }, 'image/png');
      });
    },
  };
}
