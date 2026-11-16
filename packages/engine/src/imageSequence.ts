// Image-sequence import (spec 2026-11-16-image-sequence): numbered bitmaps become a frame-by-frame
// layer, one key per picture (Flash "import sequence"). Pure: the editor store and the agent core
// both build the layer here, so they lay frames out identically.
import { createFrameLayer, createSceneObject, DEFAULT_TRANSFORM, newId } from './project';
import { snapToFrame } from './keyframes';
import type { FrameKey, ImageAsset, SceneObject } from './types';

export interface ImageSequenceOpts {
  fps: number;
  /** First key time (seconds; frame-snapped). Default 0. */
  start?: number;
  /** Frames each picture holds (1 = on ones, 2 = on twos). Default 1. */
  hold?: number;
  /** Layer position: the pictures' shared top-left. Default 0,0. */
  x?: number;
  y?: number;
  zOrder: number;
  name?: string;
  layerId?: string;
}

/** A frame layer holding one image object per key, in the given order. Every picture's top-left
 *  sits at the layer origin, so frames of one size line up exactly. */
export function buildImageSequence(images: ImageAsset[], opts: ImageSequenceOpts): { layer: SceneObject; objects: SceneObject[] } {
  if (images.length === 0) throw new Error('an image sequence needs at least one picture');
  const fps = opts.fps;
  const hold = Math.max(1, Math.round(opts.hold ?? 1));
  const start = snapToFrame(Math.max(0, opts.start ?? 0), fps);
  const layerId = opts.layerId ?? newId();
  const keys: FrameKey[] = images.map((_, i) => ({ id: `${layerId}-k${i}`, time: snapToFrame(start + (i * hold) / fps, fps) }));
  const end = snapToFrame(start + (images.length * hold) / fps, fps);
  const layer = createFrameLayer({ id: layerId, name: opts.name ?? 'Image Sequence', zOrder: opts.zOrder, keys, end });
  const placed: SceneObject = { ...layer, base: { ...layer.base, x: opts.x ?? 0, y: opts.y ?? 0 } };
  const objects = images.map((img, i) =>
    createSceneObject(img.id, {
      id: `${layerId}-f${i}`,
      name: img.name,
      zOrder: 0,
      parentId: layerId,
      frameKeyId: keys[i].id,
      anchorX: img.width / 2,
      anchorY: img.height / 2,
      base: { ...DEFAULT_TRANSFORM },
    }),
  );
  return { layer: placed, objects };
}

/** Sort file names the way a person counts: "frame2" before "frame10". */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
