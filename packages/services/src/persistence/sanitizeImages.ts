import type { Asset, ImageAsset, Project, SceneObject } from '@savig/engine';
import { sanitizeAllObjects } from './sanitizeMasks';

// Bitmap import (spec 2026-11-15-bitmap-import): load-time shape check for image assets. The only
// accepted pixels are a base64 `data:` URL of PNG / JPEG / GIF / WebP — never an external URL
// (privacy: no fetch on open) and never SVG (scripts). A malformed asset is REPAIRED, not dropped,
// so objects that reference it keep rendering (as an empty box) and nothing dangles. Returns the
// same project/array when nothing changes, so clean files stay reference-equal.

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|gif|webp));base64,[A-Za-z0-9+/]+={0,2}$/;

/** True for a base64 `data:` URL of one of the accepted bitmap types. */
export function isSafeImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' && DATA_URL_RE.test(value);
}

/** The MIME type a safe data URL declares, else null. */
export function imageDataUrlMime(value: unknown): ImageAsset['mimeType'] | null {
  if (typeof value !== 'string') return null;
  const m = DATA_URL_RE.exec(value);
  return m ? (m[1] as ImageAsset['mimeType']) : null;
}

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

function sanitizeImage(a: ImageAsset): ImageAsset {
  const mime = imageDataUrlMime(a.dataUrl);
  const badUrl = mime === null;
  const badMime = !badUrl && a.mimeType !== mime;
  const badW = !positive(a.width);
  const badH = !positive(a.height);
  const badName = typeof a.name !== 'string';
  if (!badUrl && !badMime && !badW && !badH && !badName) return a;
  return {
    ...a,
    ...(badUrl ? { dataUrl: '' } : {}),
    ...(badMime ? { mimeType: mime! } : {}),
    ...(badUrl && !IMAGE_MIME_TYPES.includes(a.mimeType) ? { mimeType: 'image/png' as const } : {}),
    ...(badW ? { width: 1 } : {}),
    ...(badH ? { height: 1 } : {}),
    ...(badName ? { name: 'Image' } : {}),
  };
}

function sanitizeGuide(o: SceneObject): SceneObject {
  if (!('guide' in o) || o.guide === true) return o;
  const out = { ...o };
  delete out.guide;
  return out;
}

export function sanitizeImages(project: Project): Project {
  return sanitizeAllObjects(sanitizeImageAssets(project), sanitizeGuide);
}

function sanitizeImageAssets(project: Project): Project {
  if (!Array.isArray(project.assets)) return project;
  let changed = false;
  const assets = project.assets.map((a: Asset) => {
    if (!a || typeof a !== 'object' || a.kind !== 'image') return a;
    const s = sanitizeImage(a);
    if (s !== a) changed = true;
    return s;
  });
  return changed ? { ...project, assets } : project;
}
