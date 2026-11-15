// Bitmap import (spec 2026-11-15-bitmap-import), agent surface: place a PNG / JPEG / GIF / WebP
// image from a data URL (or raw bytes) and mark objects as guides. Root scene, fail loud.
import { createSceneObject, DEFAULT_TRANSFORM, newId } from '@savig/engine';
import type { ImageAsset, Project, SceneObject } from '@savig/engine';
import { base64ToBytes, imageDataUrlMime, importImage, sniffImage } from '@savig/services';

export interface ImageOpts {
  /** The picture: a `data:image/(png|jpeg|gif|webp);base64,…` URL, or the file's raw bytes. */
  src: string | Uint8Array;
  /** Top-left of the placed image. */
  x: number;
  y: number;
  /** Displayed size. Omitted = natural size; only one given = the other keeps the aspect ratio.
   *  Applied as scaleX/scaleY so the asset keeps its natural box. */
  width?: number;
  height?: number;
  id?: string;
  name?: string;
  /** Editor-only reference (never exported). */
  guide?: boolean;
}

/** The asset for `src`: bytes go through the editor's importer (sniffed type, natural size); a data
 *  URL must be a safe base64 bitmap URL whose header we can read. */
function assetFor(src: string | Uint8Array, id: string, name: string): ImageAsset {
  if (typeof src !== 'string') return { ...importImage(name, src), id, name };
  const mime = imageDataUrlMime(src);
  if (!mime) throw new Error('savig/core: image src must be a base64 data:image/(png|jpeg|gif|webp) URL');
  const info = sniffImage(base64ToBytes(src.slice(src.indexOf(',') + 1)));
  if (!info) throw new Error('savig/core: image src is not a readable PNG, JPEG, GIF or WebP image');
  return { id, kind: 'image', name, mimeType: info.mimeType, dataUrl: src.replace(/^data:[^;]+/, `data:${info.mimeType}`), width: info.width, height: info.height };
}

/** Add a bitmap image object with its top-left at (x, y). Returns the object id; the asset id is
 *  `<id>-asset`. The pivot is the image centre. */
export function addImage(project: Project, opts: ImageOpts): { project: Project; id: string } {
  const id = opts.id ?? newId();
  if (project.objects.some((o) => o.id === id)) throw new Error(`savig/core: object id "${id}" already exists`);
  const name = opts.name ?? 'Image';
  const asset = assetFor(opts.src, `${id}-asset`, name);
  const sx = opts.width !== undefined ? opts.width / asset.width : undefined;
  const sy = opts.height !== undefined ? opts.height / asset.height : undefined;
  for (const v of [sx, sy]) if (v !== undefined && !(Number.isFinite(v) && v > 0)) throw new Error('savig/core: image width/height must be positive numbers');
  const scaleX = sx ?? sy ?? 1;
  const scaleY = sy ?? sx ?? 1;
  const z = project.objects.reduce((m, o) => (o.parentId ? m : Math.max(m, o.zOrder + 1)), 0);
  // The transform scales about the anchor (the box centre); offset x/y so the SCALED box's top-left
  // lands on (x, y).
  const ax = asset.width / 2;
  const ay = asset.height / 2;
  const obj: SceneObject = {
    ...createSceneObject(asset.id, {
      id,
      name,
      zOrder: z,
      anchorX: ax,
      anchorY: ay,
      base: { ...DEFAULT_TRANSFORM, x: opts.x - ax + ax * scaleX, y: opts.y - ay + ay * scaleY, scaleX, scaleY },
    }),
    ...(opts.guide ? { guide: true } : {}),
  };
  return { project: { ...project, assets: [...project.assets, asset], objects: [...project.objects, obj] }, id };
}

/** Make objects guides (shown in the editor, left out of every export) or ordinary again. */
export function setGuide(project: Project, ids: string[], guide = true): Project {
  const want = new Set(ids);
  for (const id of want) if (!project.objects.some((o) => o.id === id)) throw new Error(`savig/core: no object "${id}"`);
  return {
    ...project,
    objects: project.objects.map((o) => {
      if (!want.has(o.id)) return o;
      if (guide) return { ...o, guide: true };
      const rest = { ...o };
      delete rest.guide;
      return rest;
    }),
  };
}
